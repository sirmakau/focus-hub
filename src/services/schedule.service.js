/**
 * Schedule service.
 *
 * Responsible for:
 * - fixed vs flexible scheduling distinctions
 * - travel/preparation buffers
 * - energy-aware placement rules
 * - controlled automatic rescheduling
 * - explaining schedule changes
 */

export const ENERGY_LEVELS = ['low', 'normal', 'high'];

export const ENERGY_BEHAVIOR = {
  low: 'Light work, reading, administration, rest',
  normal: 'Regular study, assignments, routine work',
  high: 'Programming, demanding learning, deep work',
};

export function createScheduleService() {
  return {
    /**
     * Determine whether a task may be moved automatically.
     */
    mayAutoReschedule(task) {
      if (!task || !task.auto_reschedule) {
        return false;
      }
      if (!task || !task.scheduling_type) {
        return false;
      }
      return task.scheduling_type === 'flexible';
    },

    async findAvailableWindow() {
      throw new Error('Finding available windows not implemented');
    },

    async suggestAdjustment() {
      throw new Error('Schedule adjustment suggestions not implemented');
    },
  };
}
