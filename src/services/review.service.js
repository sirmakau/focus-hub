export function createReviewService() {
  return {
    async buildDailyReview(user, date) {
      throw new Error('Building daily review not implemented');
    },

    async buildWeeklyReview(user, weekStart) {
      throw new Error('Building weekly review not implemented');
    },

    async saveReflection(user, date, reflection) {
      throw new Error('Saving reflection not implemented');
    },
  };
}
