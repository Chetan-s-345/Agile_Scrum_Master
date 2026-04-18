const { z } = require('zod');

const uuidSchema = z.string().uuid();

const createStandupSchema = z.object({
  sprintId: uuidSchema.optional(),
  rawInput: z.string().min(3),
  inputChannel: z.enum(['web', 'slack', 'teams', 'voice']).default('web'),
});

const listStandupsQuerySchema = z.object({
  sprintId: uuidSchema.optional(),
  entryDate: z.string().min(1).optional(),
});

module.exports = {
  createStandupSchema,
  listStandupsQuerySchema,
};
