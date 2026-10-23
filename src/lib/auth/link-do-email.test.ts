import { describe, expect, it } from "vitest";
import { lerTokenDoFragmento } from "./link-do-email";

describe("token do link do e-mail", () => {
  it("lê só um token de 64 hexadecimais no fragmento", () => {
    const token = "a1".repeat(32);
    expect(lerTokenDoFragmento(`#t=${token}`)).toBe(token);
    expect(lerTokenDoFragmento(`#x=1&t=${token}`)).toBe(token);
    expect(lerTokenDoFragmento("#t=curto")).toBeNull();
    expect(lerTokenDoFragmento(`#t=${token.toUpperCase()}`)).toBeNull();
    expect(lerTokenDoFragmento("")).toBeNull();
  });
});
