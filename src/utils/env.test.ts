import { expect, test } from "bun:test";

import { parseBooleanEnv, parseJsonEnv, parseListEnv } from "./env";

test("parseListEnv accepts comma, semicolon, and newline separators", () => {
  expect(parseListEnv("D:/a,D:/b;D:/c\nD:/d")).toEqual(["D:/a", "D:/b", "D:/c", "D:/d"]);
});

test("parseBooleanEnv falls back and parses truthy values", () => {
  expect(parseBooleanEnv(undefined, false)).toBe(false);
  expect(parseBooleanEnv("true", false)).toBe(true);
  expect(parseBooleanEnv("YES", false)).toBe(true);
  expect(parseBooleanEnv("0", true)).toBe(false);
});

test("parseJsonEnv accepts JSON object", () => {
  expect(parseJsonEnv('{"x-api-key":"123"}', "TEST")).toEqual({ "x-api-key": "123" });
});
