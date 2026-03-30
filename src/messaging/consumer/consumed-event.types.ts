export type ConsumedEventMessage = {
  eventId?: string;
  type?: string;
  occurredAt?: string;
  /** Required for processing; validated in parser before dispatch. */
  schemaVersion?: string;
  payload?: unknown;
};
