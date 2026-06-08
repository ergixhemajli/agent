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
          // No OCR text — try vision API as fallback
          return {
            content: [
              {
                type: "text",
                text: "Tesseract found no text (likely a visual diagram). " +
                  "Try vision API: set VISION_API_KEY and use vision_image tool.",
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

  // Vision tool — uses OpenAI-compatible API to analyze any image
  // Set VISION_API_KEY and VISION_BASE_URL (or VISION_MODEL) in env
  // Falls back to OpenAI defaults if not set
  pi.registerTool({
    name: "vision_image",
    label: "Vision Image",
    description:
      "Analyze images with a vision model (GPT-4o, Claude, etc.). " +
      "Returns detailed descriptions of diagrams, UI mockups, flowcharts, " +
      "documents, or any visual content. Pass a local file path.",
    promptSnippet: "Analyze diagrams and images with vision model",
    promptGuidelines: [
      "Use vision_image to analyze diagrams, architecture diagrams, UI mockups, and screenshots.",
      "Use vision_image when ocr_image returns no text (visual diagrams).",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "File path to the image to analyze" }),
      prompt: Type.Optional(
        Type.String({
          default: "Describe everything in this image in detail, including structure, relationships, and any text.",
          description: "Question or instruction about the image.",
        })
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const apiKey = getEnv("VISION_API_KEY") || "";
      const baseUrl = getEnv("VISION_BASE_URL") || "https://api.openai.com/v1";
      const model = getEnv("VISION_MODEL") || "gpt-4o";

      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: `Vision API requires VISION_API_KEY env var.\n\n` +
                `Set one of:\n` +
                `  export VISION_API_KEY=<your-key>\n` +
                `  export VISION_BASE_URL=https://api.openai.com/v1 (default)\n` +
                `  export VISION_MODEL=gpt-4o (default)\n\n` +
                `OpenAI, Anthropic (via proxy), or any OpenAI-compatible vision API works.`,
            },
          ],
        };
      }

      const imageBase64 = base64FromFile(params.path);

      let url: string;
      let body: any;

      if (model.includes("claude")) {
        // Anthropic Claude format
        url = baseUrl.replace(/\/v1$/, "") + "/v1/messages";
        body = {
          model,
          max_tokens: 4096,
          system: "You are a helpful assistant that analyzes images. " +
            "Describe diagrams, structures, relationships, and text in detail.",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: params.prompt || "Describe everything in this image.",
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
        };
      } else {
        // OpenAI-compatible format (GPT-4o, Gemini, etc.)
        url = baseUrl + "/chat/completions";
        body = {
          model,
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
        };
      }

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        });

        if (!response.ok) {
          const errText = await response.text();
          return {
            content: [
              {
                type: "text",
                text: `Vision API error (${response.status}): ${errText}`,
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
              text: `=== Vision Analysis ===\n\n${text}\n\n=== End ===`,
            },
          ],
          details: { model, tokens: result.usage?.total_tokens },
        };
      } catch (e: any) {
        return {
          content: [
            {
              type: "text",
              text: `Vision API error: ${e.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
