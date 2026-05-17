import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.LOG_LEVEL,
  transport: {
    target: "pino-pretty",
    options: { colorize: true, translateTime: "HH:MM:ss.l" },
  },
});

export type Logger = typeof logger;
