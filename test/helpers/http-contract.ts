export function assertSuccessEnvelope(
  body: unknown,
  assertPath?: (path: string) => void,
): asserts body is {
  success: true;
  data: unknown;
  meta: unknown;
  timestamp: string;
  path: string;
} {
  expect(body).toEqual(
    expect.objectContaining({
      success: true,
      data: expect.anything(),
      meta: expect.anything(),
      timestamp: expect.any(String),
      path: expect.any(String),
    }),
  );
  const b = body as { path: string; timestamp: string };
  expect(Date.parse(b.timestamp)).not.toBeNaN();
  if (assertPath) {
    assertPath(b.path);
  }
}

export function assertErrorEnvelope(
  body: unknown,
  expectedStatus: number,
  assertPath?: (path: string) => void,
): asserts body is {
  success: false;
  error: { statusCode: number; message: string };
  timestamp: string;
  path: string;
} {
  expect(body).toEqual(
    expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        statusCode: expectedStatus,
        message: expect.any(String),
      }),
      timestamp: expect.any(String),
      path: expect.any(String),
    }),
  );
  const b = body as { error: { statusCode: number }; timestamp: string; path: string };
  expect(b.error.statusCode).toBe(expectedStatus);
  expect(Date.parse(b.timestamp)).not.toBeNaN();
  if (assertPath) {
    assertPath(b.path);
  }
}
