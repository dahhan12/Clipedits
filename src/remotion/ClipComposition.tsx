import React from "react";
import { z } from "zod";
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

/**
 * The 9:16 clip composition: the trimmed base clip with campaign-permitted
 * overlays (captions / mentions / logos / required text) drawn on top. Overlay
 * content is decided upstream by the render service — this component only draws
 * what it is given, so nothing is ever added that the campaign did not permit.
 */

export const clipSchema = z.object({
  videoSrc: z.string(),
  overlays: z.array(z.string()),
  logoText: z.string().optional(),
});

export type ClipCompositionProps = z.infer<typeof clipSchema>;

/** A single caption line that springs up and fades in, staggered by index. */
const AnimatedCaption: React.FC<{ line: string; index: number }> = ({ line, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delay = index * 6;
  const enter = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  const opacity = interpolate(enter, [0, 1], [0, 1]);
  const translateY = interpolate(enter, [0, 1], [24, 0]);
  return (
    <span
      style={{
        color: "white",
        fontSize: 44,
        fontWeight: 800,
        textAlign: "center",
        lineHeight: 1.2,
        textShadow: "0 2px 10px rgba(0,0,0,0.9)",
        marginTop: 8,
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      {line}
    </span>
  );
};

export const ClipComposition: React.FC<ClipCompositionProps> = ({ videoSrc, overlays, logoText }) => {
  const src = /^(https?:|file:|data:)/.test(videoSrc) ? videoSrc : staticFile(videoSrc);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <OffthreadVideo src={src} />
      {logoText ? (
        <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", padding: 40 }}>
          <span style={{ color: "white", fontSize: 32, fontWeight: 700, opacity: 0.9, textShadow: "0 2px 8px #000" }}>
            {logoText}
          </span>
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: "0 48px 140px" }}>
        {overlays.map((line, i) => (
          <AnimatedCaption key={i} line={line} index={i} />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
