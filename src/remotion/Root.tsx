import React from "react";
import { Composition, getInputProps } from "remotion";
import { ClipComposition, clipSchema } from "./ClipComposition";

const FPS = 30;

/**
 * Remotion root. Duration and dimensions come from input props supplied by the
 * render service (derived from the clip range and configured frame size), so a
 * single composition serves every clip.
 */
export const RemotionRoot: React.FC = () => {
  const input = getInputProps() as Partial<{
    videoSrc: string;
    overlays: string[];
    logoText: string;
    durationInFrames: number;
    width: number;
    height: number;
  }>;

  return (
    <Composition
      id="Clip"
      component={ClipComposition}
      schema={clipSchema}
      durationInFrames={Math.max(1, input.durationInFrames ?? FPS * 15)}
      fps={FPS}
      width={input.width ?? 1080}
      height={input.height ?? 1920}
      defaultProps={{ videoSrc: input.videoSrc ?? "", overlays: input.overlays ?? [], logoText: input.logoText }}
    />
  );
};
