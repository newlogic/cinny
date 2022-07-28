import React from 'react';
import PropTypes from 'prop-types';
import './PowerLevelSelector.scss';

import { MenuHeader, MenuItem } from '../../atoms/context-menu/ContextMenu';

function PowerLevelSelector({
  value, max, onSelect,
}) {
  return (
    <div className="power-level-selector">
      {max >= 0 && <MenuHeader>Presets</MenuHeader>}
      {max >= 50 && <MenuItem variant={value === 50 ? 'positive' : 'surface'} onClick={() => onSelect(50)}>Exhibitor - 50</MenuItem>}
      {max >= 0 && <MenuItem variant={value === 0 ? 'positive' : 'surface'} onClick={() => onSelect(0)}>Member - 0</MenuItem>}
    </div>
  );
}

PowerLevelSelector.propTypes = {
  value: PropTypes.number.isRequired,
  max: PropTypes.number.isRequired,
  onSelect: PropTypes.func.isRequired,
};

export default PowerLevelSelector;
