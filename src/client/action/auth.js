import * as sdk from 'matrix-js-sdk';
import { deriveKey } from 'matrix-js-sdk/lib/crypto/key_passphrase';
import jwtDecode from 'jwt-decode';
import cons from '../state/cons';

import { secret } from '../state/auth';
import { getUrlPrams, removeUrlParams, setUrlParams } from '../../util/common';
import logout from './logout';
import initMatrix from '../initMatrix';
import {
  clearSecretStorageKeys,
  deletePrivateKey,
  getPrivateKey,
  hasPrivateKey,
  storePrivateKey,
} from '../state/secretStorageKeys';
import { getDefaultSSKey, getSSKeyInfo } from '../../util/matrixUtil';

function updateLocalStore(accessToken, deviceId, userId, baseUrl) {
  localStorage.setItem(cons.secretKey.ACCESS_TOKEN, accessToken);
  localStorage.setItem(cons.secretKey.DEVICE_ID, deviceId);
  localStorage.setItem(cons.secretKey.USER_ID, userId);
  localStorage.setItem(cons.secretKey.BASE_URL, baseUrl);
}

function createTemporaryClient(baseUrl) {
  return sdk.createClient({ baseUrl });
}

async function startSsoLogin(baseUrl, type, idpId) {
  const client = createTemporaryClient(baseUrl);
  localStorage.setItem(cons.secretKey.BASE_URL, client.baseUrl);
  window.location.href = client.getSsoLoginUrl(window.location.href, type, idpId);
}

async function login(baseUrl, username, email, password) {
  const identifier = {};
  if (username) {
    identifier.type = 'm.id.user';
    identifier.user = username;
  } else if (email) {
    identifier.type = 'm.id.thirdparty';
    identifier.medium = 'email';
    identifier.address = email;
  } else throw new Error('Bad Input');

  const client = createTemporaryClient(baseUrl);
  const res = await client.login('m.login.password', {
    identifier,
    password,
    initial_device_display_name: cons.DEVICE_DISPLAY_NAME,
  });

  const myBaseUrl = res?.well_known?.['m.homeserver']?.base_url || client.baseUrl;
  updateLocalStore(res.access_token, res.device_id, res.user_id, myBaseUrl);
}

async function loginWithToken(baseUrl, token) {
  const client = createTemporaryClient(baseUrl);

  const res = await client.login('m.login.token', {
    token,
    initial_device_display_name: cons.DEVICE_DISPLAY_NAME,
  });

  const myBaseUrl = res?.well_known?.['m.homeserver']?.base_url || client.baseUrl;
  updateLocalStore(res.access_token, res.device_id, res.user_id, myBaseUrl);
}

async function loginWithJWT(baseUrl, token, deviceId) {
  const client = createTemporaryClient(baseUrl);

  const res = await client.login('org.matrix.login.jwt', {
    token,
    device_id: deviceId,
  });

  const myBaseUrl = res?.well_known?.['m.homeserver']?.base_url || client.baseUrl;
  updateLocalStore(res.access_token, res.device_id, res.user_id, myBaseUrl);
  localStorage.setItem(cons.jwt.TOKEN, token);
}

async function setupCrossSigning(setupKey, restoreKey) {
  const mx = initMatrix.matrixClient;
  const recoveryKey = await mx.createRecoveryKeyFromPassphrase(restoreKey);
  clearSecretStorageKeys();

  await mx.bootstrapSecretStorage({
    createSecretStorageKey: async () => recoveryKey,
    setupNewKeyBackup: true,
    setupNewSecretStorage: true,
  });

  const authUploadDeviceSigningKeys = async (makeRequest) => {
    await makeRequest({
      type: 'm.login.password',
      password: setupKey,
      identifier: {
        type: 'm.id.user',
        user: secret.userId,
      },
    });
  };

  await mx.bootstrapCrossSigning({
    authUploadDeviceSigningKeys,
    setupNewCrossSigning: true,
  });

  await fetch('/matrix-chat/cross-signing-complete', {
    method: 'POST',
    credentials: 'include',
  });
}

async function restoreCrossSigning(recoveryKey) {
  const mx = initMatrix.matrixClient;

  let keyData;
  const defaultSSKey = getDefaultSSKey();
  if (hasPrivateKey(defaultSSKey)) {
    keyData = { keyId: defaultSSKey, privateKey: getPrivateKey(defaultSSKey) };
  } else {
    const sSKeyInfo = getSSKeyInfo(defaultSSKey);
    const { salt, iterations } = sSKeyInfo.passphrase || {};
    const privateKey = await deriveKey(recoveryKey, salt, iterations);
    keyData = {
      keyId: defaultSSKey,
      phrase: recoveryKey,
      privateKey,
    };
    storePrivateKey(keyData.keyId, keyData.privateKey);
  }
  try {
    const backupInfo = await mx.getKeyBackupVersion();
    await mx.restoreKeyBackupWithSecretStorage(
      backupInfo,
      undefined,
      undefined,
    );
  } catch (error) {
    if (error.errcode === 'RESTORE_BACKUP_ERROR_BAD_KEY') {
      deletePrivateKey(keyData.keyId);
    }
  }
}

async function verifyCurrentJWT() {
  const jwt = getUrlPrams('jwt');
  const currentJWT = localStorage.getItem(cons.jwt.TOKEN);
  if (jwt && secret.userId) {
    const decoded = jwtDecode(jwt);
    const userId = secret.userId.match(/^@(?<userid>.+?):.+?$/).groups.userid;
    if (decoded.sub !== userId || !currentJWT) {
      logout();
      return false;
    }
  }
  if (secret.baseUrl && currentJWT) {
    try {
      // Reverify current token if it is still valid (e.g. not expired)
      await loginWithJWT(secret.baseUrl, currentJWT, secret.deviceId);
    } catch (error) {
      if (jwt && secret.deviceId) {
        setUrlParams('deviceId', secret.deviceId);
      }
      logout();
      return false;
    }
  }

  const csSetupKey = getUrlPrams('csSetupKey');
  const csRecoveryKey = getUrlPrams('csRecoveryKey');
  removeUrlParams('csSetupKey');
  removeUrlParams('csRecoveryKey');
  if (csRecoveryKey && window.crypto?.subtle) {
    if (csSetupKey) {
      await setupCrossSigning(csSetupKey, csRecoveryKey);
    } else {
      await restoreCrossSigning(csRecoveryKey);
    }
  }

  removeUrlParams('jwt');
  return true;
}

// eslint-disable-next-line camelcase
async function verifyEmail(baseUrl, email, client_secret, send_attempt, next_link) {
  const res = await fetch(`${baseUrl}/_matrix/client/r0/register/email/requestToken`, {
    method: 'POST',
    body: JSON.stringify({
      email, client_secret, send_attempt, next_link,
    }),
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    credentials: 'same-origin',
  });
  const data = await res.json();
  return data;
}

async function completeRegisterStage(
  baseUrl, username, password, auth,
) {
  const tempClient = createTemporaryClient(baseUrl);

  try {
    const result = await tempClient.registerRequest({
      username,
      password,
      auth,
      initial_device_display_name: cons.DEVICE_DISPLAY_NAME,
    });
    const data = { completed: result.completed || [] };
    if (result.access_token) {
      data.done = true;
      updateLocalStore(result.access_token, result.device_id, result.user_id, baseUrl);
    }
    return data;
  } catch (e) {
    const result = e.data;
    const data = { completed: result.completed || [] };
    if (result.access_token) {
      data.done = true;
      updateLocalStore(result.access_token, result.device_id, result.user_id, baseUrl);
    }
    return data;
  }
}

export {
  createTemporaryClient, login, verifyEmail,
  loginWithToken, loginWithJWT, verifyCurrentJWT,
  startSsoLogin, completeRegisterStage,
};
