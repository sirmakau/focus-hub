import { ENERGY_LEVELS } from './schedule.service.js';

export function isValidEnergyLevel(value) {
  return ENERGY_LEVELS.includes(value);
}

export function createEnergyService() {
  return {
    async recordCheckin(user, level, note) {
      if (!isValidEnergyLevel(level)) {
        throw new Error(`Invalid energy level: ${level}`);
      }
      throw new Error('Recording energy checkins not implemented');
    },

    async getRecentCheckin(user) {
      throw new Error('Fetching recent energy checkin not implemented');
    },
  };
}
