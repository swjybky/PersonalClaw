export {};

declare global {
  namespace NodeJS {
    interface Process {
      parentPort?: {
        postMessage(message: unknown): void;
        on(event: "message", listener: (message: unknown) => void): void;
      };
    }
  }
}
