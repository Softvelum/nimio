// Mock logger
const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("@/shared/logger", () => {
  const LoggersFactory = {
    create: vi.fn(() => mockLogger),
    setLevel: vi.fn(),
    toggleWorkletLogs: vi.fn(),
  };
  return { LoggersFactory };
});

export { mockLogger };
