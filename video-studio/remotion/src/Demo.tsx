import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

type Props = { title: string; subtitle: string };

export const Demo: React.FC<Props> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const enter = spring({ frame: frame - 6, fps, config: { damping: 200 } });
  const subIn = spring({ frame: frame - 27, fps, config: { damping: 200 } });
  const fadeOut = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(circle at 30% 30%, #1e293b, #0b1020)",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: '"Noto Sans", sans-serif',
        opacity: fadeOut,
      }}
    >
      <h1
        style={{
          color: "#f5f3ee",
          fontSize: 96,
          fontWeight: 700,
          margin: 0,
          transform: `translateY(${(1 - enter) * 60}px) scale(${1 + frame / 3000})`,
          opacity: enter,
        }}
      >
        {title}
      </h1>
      <p
        style={{
          color: "#fda4af",
          fontSize: 40,
          marginTop: 24,
          opacity: subIn,
          transform: `translateY(${(1 - subIn) * 20}px)`,
        }}
      >
        {subtitle}
      </p>
    </AbsoluteFill>
  );
};
