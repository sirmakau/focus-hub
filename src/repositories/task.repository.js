/**
 * Task repository.
 *
 * Planned operations:
 * - create
 * - findById
 * - findByUserAndDate
 * - findByUserAndStatus
 * - updateStatus
 * - updateSchedule
 * - recordHistory (within a transaction)
 * - listByCategory
 * - recurring occurrence expansion (later)
 */

export function createTaskRepository() {
  return {
    async create(attributes) {
      throw new Error('Task repository create not implemented');
    },

    async findById(id) {
      throw new Error('Task repository findById not implemented');
    },

    async findByUserAndDate(user, date) {
      throw new Error('Task repository findByUserAndDate not implemented');
    },

    async findByUserAndStatus(user, status) {
      throw new Error('Task repository findByUserAndStatus not implemented');
    },
  };
}
