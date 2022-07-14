import React from 'react';
import PropTypes from 'prop-types';
import './RoomViewHeaderEmbedded.scss';

import { twemojify } from '../../../util/twemojify';

import initMatrix from '../../../client/initMatrix';
import { toggleRoomSettings } from '../../../client/action/navigation';
import colorMXID from '../../../util/colorMXID';

import Header, { TitleWrapper } from '../../atoms/header/Header';
import Avatar from '../../atoms/avatar/Avatar';
import Text from '../../atoms/text/Text';
import IconButton from '../../atoms/button/IconButton';

import VerticalMenuIC from '../../../../public/res/ic/outlined/vertical-menu.svg';

function RoomViewHeaderEmbedded({ roomId }) {
  const mx = initMatrix.matrixClient;
  const isDM = initMatrix.roomList.directs.has(roomId);
  let avatarSrc = mx.getRoom(roomId).getAvatarUrl(mx.baseUrl, 36, 36, 'crop');
  avatarSrc = isDM ? mx.getRoom(roomId).getAvatarFallbackMember()?.getAvatarUrl(mx.baseUrl, 36, 36, 'crop') : avatarSrc;
  const roomName = mx.getRoom(roomId).name;

  return (
    <Header>
      <div className="room-header__title">
        <Avatar imageSrc={avatarSrc} text={roomName} bgColor={colorMXID(roomId)} size="extra-small" />
        <TitleWrapper>
          <Text variant="s1" weight="medium" primary>{twemojify(roomName)}</Text>
        </TitleWrapper>
      </div>
      <IconButton onClick={() => toggleRoomSettings()} tooltip="Options" src={VerticalMenuIC} size="extra-small" />
    </Header>
  );
}

RoomViewHeaderEmbedded.propTypes = {
  roomId: PropTypes.string.isRequired,
};

export default RoomViewHeaderEmbedded;
