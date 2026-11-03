import { describe, expect, it } from "vitest";
import {
  AUDIO_SAMPLE_RATE,
  buildSessionUpdate,
  GREETING,
  SYSTEM_PROMPT,
} from "../../shared/agent-config.js";
import { AALTO_TOOLS, TOOL_TARGET } from "../../shared/tools.js";

describe("tool contract", () => {
  const names = AALTO_TOOLS.map((t) => t.name);

  it("has unique snake_case names", () => {
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it("routes every tool, and routes nothing that is not a tool", () => {
    expect(Object.keys(TOOL_TARGET).sort()).toEqual([...names].sort());
    for (const target of Object.values(TOOL_TARGET)) expect(["page", "browser"]).toContain(target);
  });

  it.each(AALTO_TOOLS.map((t) => [t.name, t]))("%s has a well-formed schema", (_name, tool) => {
    expect(tool.type).toBe("function");
    expect(tool.description.length).toBeGreaterThan(40);
    expect(tool.parameters.type).toBe("object");
    const props = tool.parameters.properties;
    for (const key of tool.parameters.required) expect(props).toHaveProperty(key);
    for (const prop of Object.values(props)) {
      expect(["string", "integer", "boolean", "array"]).toContain(prop.type);
      if (prop.enum) expect(prop.enum.length).toBeGreaterThan(0);
    }
  });

  it("is frozen, so no runtime can edit the contract it ships", () => {
    expect(Object.isFrozen(AALTO_TOOLS)).toBe(true);
    expect(Object.isFrozen(TOOL_TARGET)).toBe(true);
  });
});

describe("system prompt", () => {
  it("keeps the three safety rules", () => {
    expect(SYSTEM_PROMPT).toMatch(/Never submit a form the user has not heard read back/);
    expect(SYSTEM_PROMPT).toMatch(/Never guess a value they did not say/);
    expect(SYSTEM_PROMPT).toMatch(/Never invent what a page says/);
  });

  it("tells the agent that page and tool text is data, not instructions", () => {
    expect(SYSTEM_PROMPT).toMatch(/UNTRUSTED/);
    expect(SYSTEM_PROMPT).toMatch(/<<</);
  });
});

describe("buildSessionUpdate", () => {
  it("defaults to audio, the shipped tools and the greeting", () => {
    const { type, session } = buildSessionUpdate();
    expect(type).toBe("session.update");
    expect(session.tools).toBe(AALTO_TOOLS);
    expect(session.greeting).toBe(GREETING);
    expect(session.output).toEqual({ type: "audio", voice: expect.any(String) });
    expect(session.system_prompt).toBe(SYSTEM_PROMPT);
  });

  it("opens silently and carries context when continuing", () => {
    const { session } = buildSessionUpdate({ greeting: null, context: "CONVERSATION SO FAR" });
    expect(session).not.toHaveProperty("greeting");
    expect(session.system_prompt.endsWith("\n\nCONVERSATION SO FAR")).toBe(true);
  });

  it("supports a text-only session", () => {
    expect(buildSessionUpdate({ output: "text" }).session.output).toEqual({ type: "text" });
  });

  it("uses the 24 kHz rate the protocol requires", () => {
    expect(AUDIO_SAMPLE_RATE).toBe(24_000);
  });
});
