import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function base64FromFile(path: string): string {
  const fs = require("fs");
  return fs.readFileSync(path).toString("base64");
}

function getEnv(key: string): string {
  return process.env[key] ?? "";
}

export default function (pi: ExtensionAPI) {
  // OCR tool — works for any image (diagrams, text, screenshots, etc.)
  pi.registerTool({
    name: "ocr_image",
    label: "OCR Image",
    description:
      "Extract all text from an image file. Supports diagrams, documents, " +
      "screenshots, and any image with text. Pass a local file path.",
    promptSnippet: "Extract text or analyze diagrams using ocr_image",
    promptGuidelines: [
      "Use ocr_image to extract text from any image file path (e.g. /tmp/diagram.png).",
      "Use ocr_image to read diagrams, flowcharts, UI mockups, or screenshots.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "File path to the image to OCR" }),
      lang: Type.Optional(
        Type.String({
          default: "eng",
          description:
            "Language code for text extraction. Default 'eng'. Try 'eng+nor' for Norwegian.",
        })
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      try {
        const { stdout, stderr, status } = await execAsync(
          `tesseract '${params.path}' stdout -l ${params.lang || "eng"} --psm 1 2>&1`,
          { signal, timeout: 30_000 }
        );

        if (status !== 0) {
          return {
            content: [
              {
                type: "text",
                text: `Tesseract OCR failed (exit code ${status}).\nstderr: ${stderr}\nstdout: ${stdout}`,
              },
            ],
            isError: true,
          };
        }

        const text = stdout.trim();
        if (!text) {
          return {
            content: [
              {
                type: "text",
                text: "Tesseract found no text (likely a visual diagram). " +
                  "Use vision_image tool to analyze this image with an AI vision model.",
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `=== OCR Result ===\n\n${text}\n\n=== End ===`,
            },
          ],
          details: {
            lines: text.split("\n").length,
            chars: text.length,
          },
        };
      } catch (e: any) {
        return {
          content: [
            {
              type: "text",
              text: `OCR error: ${e.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });

  // Vision tool — sends image to a vision API for analysis
  // Supports: local Ollama (default), OpenAI, Anthropic Claude, Google Gemini
  // Set VISION_API_KEY and optionally VISION_PROVIDER in env
  pi.registerTool({
    name: "vision_image",
    label: "Vision Image",
    description:
      "Analyze images with a vision model. Returns detailed descriptions " +
      "of diagrams, UI mockups, flowcharts, documents, or any visual content. " +
      "Pass a local file path. Use local (Ollama) by default.",
    promptSnippet: "Analyze diagrams and images with vision model",
    promptGuidelines: [
      "Use vision_image to analyze diagrams, architecture diagrams, UI mockups, and screenshots.",
      "Use vision_image when ocr_image returns no text (visual diagrams).",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "File path to the image to analyze" }),
      prompt: Type.Optional(
        Type.String({
          default: "Describe everything in this image in detail, including all text, folder names, file names, numbers, and structural relationships. Return a clean text outline.",
          description: "Question or instruction about the image.",
        })
      ),
      provider: Type.Optional(
        Type.Enum({
          local: "Local Ollama (Qwen3.6-35B)",
          openai: "OpenAI (gpt-4o)",
          anthropic: "Anthropic Claude",
          google: "Google Gemini",
        }),
        { description: "Vision provider. Default is local." }
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const apiKey = getEnv("VISION_API_KEY") || "";
      const providerOverride = params.provider;
      const imageBase64 = base64FromFile(params.path);

      let provider = providerOverride;
      if (!provider) {
        provider = apiKey ? "openai" : "local";
      }

      // Local Ollama
      if (provider === "local") {
        try {
          const response = await fetch("http://127.0.0.1:11434/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer ollama",
            },
            body: JSON.stringify({
              model: "gemma-4-26B-A4B-it-UD-Q4_K_XL",
              max_tokens: 4096,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: params.prompt || "Describe everything in this image in detail, including all text, folder names, file names, numbers, and structural relationships. Return a clean text outline.",
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:image/png;base64,${imageBase64}`,
                        detail: "high",
                      },
                    },
                  ],
                },
              ],
              stream: false,
            }),
            signal,
          });

          if (!response.ok) {
            const errText = await response.text();
            return {
              content: [
                {
                  type: "text",
                  text: `Ollama error (${response.status}): ${errText}`,
                },
              ],
              isError: true,
            };
          }

          const result = await response.json();
          const text = result.choices?.[0]?.message?.content ?? "No response";
          return {
            content: [
              {
                type: "text",
                text: `=== Vision (Local gemma-4-26B) ===\n\n${text}\n\n=== End ===`,
              },
            ],
            details: { model: "gemma-4-26B-A4B" },
          };
        } catch (e: any) {
          return {
            content: [
              {
                type: "text",
                text: `Local vision error: ${e.message}. Is Ollama running?`,
              },
            ],
            isError: true,
          };
        }
      }

      // OpenAI
      if (provider === "openai") {
        if (!apiKey) {
          return {
            content: [
              {
                type: "text",
                text: `OpenAI vision requires VISION_API_KEY.\nSet: export VISION_API_KEY=sk-...`,
              },
            ],
          };
        }
        try {
          const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-4o",
              max_tokens: 4096,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: params.prompt || "Describe everything in this image in detail.",
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:image/png;base64,${imageBase64}`,
                      },
                    },
                  ],
                },
              ],
            }),
            signal,
          });

          if (!response.ok) {
            const errText = await response.text();
            return {
              content: [{ type: "text", text: `OpenAI error (${response.status}): ${errText}` }],
              isError: true,
            };
          }

          const result = await response.json();
          const text = result.choices?.[0]?.message?.content ?? "No response";
          return {
            content: [{ type: "text", text: `=== Vision (GPT-4o) ===\n\n${text}\n\n=== End ===` }],
            details: { model: "gpt-4o" },
          };
        } catch (e: any) {
          return {
            content: [{ type: "text", text: `OpenAI error: ${e.message}` }],
            isError: true,
          };
        }
      }

      // Anthropic
      if (provider === "anthropic") {
        if (!apiKey) {
          return { content: [{ type: "text", text: `Anthropic requires VISION_API_KEY.` }] };
        }
        try {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 4096,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: params.prompt || "Describe everything in this image.",
                    },
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: "image/png",
                        data: imageBase64,
                      },
                    },
                  ],
                },
              ],
            }),
            signal,
          });

          if (!response.ok) {
            const errText = await response.text();
            return {
              content: [{ type: "text", text: `Anthropic error (${response.status}): ${errText}` }],
              isError: true,
            };
          }

          const result = await response.json();
          const text = result.content?.find((c: any) => c.type === "text")?.text ?? "No response";
          return {
            content: [{ type: "text", text: `=== Vision (Claude) ===\n\n${text}\n\n=== End ===` }],
            details: { model: "claude-sonnet-4" },
          };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Anthropic error: ${e.message}` }], isError: true };
        }
      }

      // Google Gemini
      if (provider === "google") {
        if (!apiKey) {
          return { content: [{ type: "text", text: `Google Gemini requires VISION_API_KEY.` }] };
        }
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: params.prompt || "Describe everything in this image.",
                      },
                      {
                        inline_data: {
                          mime_type: "image/png",
                          data: imageBase64,
                        },
                      },
                    ],
                  },
                ],
              }),
              signal,
            }
          );

          if (!response.ok) {
            const errText = await response.text();
            return {
              content: [{ type: "text", text: `Google error (${response.status}): ${errText}` }],
              isError: true,
            };
          }

          const result = await response.json();
          const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "No response";
          return {
            content: [{ type: "text", text: `=== Vision (Gemini) ===\n\n${text}\n\n=== End ===` }],
            details: { model: "gemini-2.0-flash" },
          };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Google error: ${e.message}` }], isError: true };
        }
      }

      return {
        content: [{ type: "text", text: `Unknown provider: ${provider}` }],
        isError: true,
      };
    },
  });
}
