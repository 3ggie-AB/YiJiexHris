import { expect, test } from "bun:test";

import { extractFirstJsonObject, extractOutputText } from "./responses";

test("extractOutputText joins assistant message text blocks", () => {
  const output = extractOutputText({
    output: [
      {
        type: "message",
        content: [
          { type: "output_text", text: "{\"hello\":" },
          { type: "output_text", text: "\"world\"}" },
        ],
      },
    ],
  });

  expect(output).toBe("{\"hello\":\"world\"}");
});

test("extractFirstJsonObject extracts JSON from surrounding text", () => {
  expect(extractFirstJsonObject("before {\"ok\":true} after")).toBe("{\"ok\":true}");
});
