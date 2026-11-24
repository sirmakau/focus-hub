/**
 * Schedule repository.
 *
 * Planned operations:
 * - fixed commitments for a day
 * - recurring calendar events (e.g. university timetable)
 * - available time windows
 * - travel and buffer calculations
 */

export function createScheduleRepository() {
  return {
    async fixedCommitmentsForDay(user, date) {
      throw new Error('Schedule repository fixedCommitmentsForDay not implemented');
    },

    async listCalendarEvents(user, rangeStart, rangeEnd) {
      throw new Error('Schedule repository listCalendarEvents not implemented');
    },

    async saveCalendarEvent(attributes) {
      throw new Error('Schedule repository saveCalendarEvent not implemented');
    },
  };
}
