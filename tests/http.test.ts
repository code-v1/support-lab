import { expect, it } from "vitest";
import { isSameOrigin } from "@/lib/http";
it("accepts the actual browser host when Next normalizes the request URL", () => {
  const request = new Request("http://localhost:3100/api/lab", {
    headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" },
  });
  expect(isSameOrigin(request)).toBe(true);
});
it("rejects cross-origin and malformed browser mutations", () => {
  expect(
    isSameOrigin(
      new Request("http://localhost:3100/api/lab", {
        headers: {
          host: "127.0.0.1:3100",
          origin: "https://unrelated.example",
        },
      }),
    ),
  ).toBe(false);
  expect(
    isSameOrigin(
      new Request("http://localhost:3100/api/lab", {
        headers: { origin: "invalid" },
      }),
    ),
  ).toBe(false);
});
