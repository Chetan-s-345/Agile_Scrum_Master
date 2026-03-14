const morgan = require('morgan');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

const morganStream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

module.exports = { logger, morganStream, morgan };
