import React from "react";

export type PepperState =
  | "listening"
  | "thinking"
  | "spicy"
  | "alert"
  | "hype"
  | "coach";

export type PepperSize = "xs" | "sm" | "md" | "lg";

const SIZE_PX: Record<PepperSize, number> = {
  xs: 28,
  sm: 48,
  md: 80,
  lg: 120,
};

interface PepperMascotProps {
  state?: PepperState;
  size?: PepperSize;
  className?: string;
  title?: string;
}

const NAVY = "#1B2340";
const BANANA = "#FFCE3A";
const BANANA_SHADE = "#E8B420";
const LEAF = "#2FB67C";
const LEAF_DARK = "#1F8A5A";
const CORAL = "#FF7A5C";
const CREAM = "#FFF7E6";

export default function PepperMascot({
  state = "listening",
  size = "md",
  className,
  title,
}: PepperMascotProps) {
  const px = SIZE_PX[size];

  return (
    <svg
      role={title ? "img" : "presentation"}
      aria-label={title ?? `Pepper — ${state}`}
      className={className}
      width={px}
      height={px}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Soft cream backdrop disc — keeps Pepper readable on any surface */}
      <circle cx="60" cy="62" r="54" fill={CREAM} opacity="0" />

      {/* Body shadow (under) */}
      <ellipse cx="62" cy="112" rx="22" ry="3.5" fill={NAVY} opacity="0.18" />

      {/* Leaf stem — slight curl */}
      <g>
        <path
          d="M58 16 C 54 8, 44 6, 38 10 C 44 14, 48 20, 52 24 C 55 22, 57 19, 58 16 Z"
          fill={LEAF}
          stroke={NAVY}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path
          d="M45 12 C 47 16, 49 19, 52 22"
          stroke={LEAF_DARK}
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
        {/* Stem nub */}
        <path
          d="M58 16 C 60 20, 60 24, 58 28"
          stroke={NAVY}
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
      </g>

      {/* Body — elongated banana-pepper shape, curved */}
      <path
        d="
          M 58 26
          C 44 28, 34 40, 34 56
          C 34 74, 40 92, 52 104
          C 62 112, 76 110, 82 100
          C 90 86, 88 70, 84 54
          C 80 40, 76 30, 66 26
          C 63 25, 60 25, 58 26 Z
        "
        fill={BANANA}
        stroke={NAVY}
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Curve highlight */}
      <path
        d="M 44 44 C 40 56, 42 74, 50 90"
        stroke={BANANA_SHADE}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.65"
      />

      {/* Headset — band across top behind head, earcups + mic boom on right */}
      <g>
        {/* Band */}
        <path
          d="M 40 36 C 48 26, 76 26, 84 40"
          stroke={NAVY}
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
        {/* Left earcup */}
        <ellipse
          cx="38"
          cy="46"
          rx="6"
          ry="7"
          fill={NAVY}
          stroke={NAVY}
          strokeWidth="2"
        />
        <ellipse cx="40" cy="46" rx="2" ry="2.5" fill={BANANA} />
        {/* Right earcup */}
        <ellipse
          cx="86"
          cy="48"
          rx="6"
          ry="7"
          fill={NAVY}
          stroke={NAVY}
          strokeWidth="2"
        />
        <ellipse cx="84" cy="48" rx="2" ry="2.5" fill={BANANA} />
        {/* Mic boom arm */}
        <path
          d="M 86 54 C 90 62, 86 70, 76 72"
          stroke={NAVY}
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
        {/* Mic tip */}
        <circle cx="74" cy="72" r="2.5" fill={CORAL} stroke={NAVY} strokeWidth="1.5" />
      </g>

      {/* Face group — eyes & mouth change per state */}
      <Face state={state} />

      {/* Extras per state */}
      <Extras state={state} />
    </svg>
  );
}

function Face({ state }: { state: PepperState }) {
  const eyeY = 62;
  const leftX = 52;
  const rightX = 68;

  switch (state) {
    case "listening":
      return (
        <g>
          {/* Calm round eyes */}
          <circle cx={leftX} cy={eyeY} r="2.8" fill={NAVY} />
          <circle cx={rightX} cy={eyeY} r="2.8" fill={NAVY} />
          {/* Small smile */}
          <path
            d="M 54 74 Q 60 80, 68 74"
            stroke={NAVY}
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
          {/* Subtle cheek blush */}
          <circle cx="46" cy="72" r="3" fill={CORAL} opacity="0.35" />
          <circle cx="76" cy="72" r="3" fill={CORAL} opacity="0.35" />
        </g>
      );

    case "thinking":
      return (
        <g>
          {/* Left eye open */}
          <circle cx={leftX} cy={eyeY} r="2.8" fill={NAVY} />
          {/* Right eye closed (arch) */}
          <path
            d={`M ${rightX - 4} ${eyeY} Q ${rightX} ${eyeY - 3}, ${rightX + 4} ${eyeY}`}
            stroke={NAVY}
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
          {/* Small pondering mouth */}
          <path
            d="M 56 76 Q 60 74, 64 76"
            stroke={NAVY}
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      );

    case "spicy":
      return (
        <g>
          {/* Narrowed eyes */}
          <path
            d={`M ${leftX - 3} ${eyeY} L ${leftX + 3} ${eyeY}`}
            stroke={NAVY}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d={`M ${rightX - 3} ${eyeY} L ${rightX + 3} ${eyeY}`}
            stroke={NAVY}
            strokeWidth="3"
            strokeLinecap="round"
          />
          {/* Smirky mouth */}
          <path
            d="M 54 76 Q 60 72, 68 78"
            stroke={NAVY}
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      );

    case "alert":
      return (
        <g>
          {/* Wide eyes */}
          <circle cx={leftX} cy={eyeY} r="4" fill="#FFFEFA" stroke={NAVY} strokeWidth="2" />
          <circle cx={leftX} cy={eyeY} r="1.8" fill={NAVY} />
          <circle cx={rightX} cy={eyeY} r="4" fill="#FFFEFA" stroke={NAVY} strokeWidth="2" />
          <circle cx={rightX} cy={eyeY} r="1.8" fill={NAVY} />
          {/* Open small O mouth */}
          <ellipse cx="60" cy="78" rx="3" ry="3.5" fill={NAVY} />
        </g>
      );

    case "hype":
      return (
        <g>
          {/* X eyes of joy */}
          <XEye cx={leftX} cy={eyeY} />
          <XEye cx={rightX} cy={eyeY} />
          {/* Open smile with tongue */}
          <path
            d="M 50 74 Q 60 86, 70 74 Z"
            fill={NAVY}
            stroke={NAVY}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M 57 81 Q 60 86, 63 81 Q 62 84, 60 85 Q 58 84, 57 81 Z"
            fill={CORAL}
          />
        </g>
      );

    case "coach":
      return (
        <g>
          {/* Nerdy round glasses */}
          <circle
            cx={leftX}
            cy={eyeY}
            r="5"
            fill="#FFFEFA"
            stroke={NAVY}
            strokeWidth="2"
          />
          <circle cx={leftX} cy={eyeY} r="1.8" fill={NAVY} />
          <circle
            cx={rightX}
            cy={eyeY}
            r="5"
            fill="#FFFEFA"
            stroke={NAVY}
            strokeWidth="2"
          />
          <circle cx={rightX} cy={eyeY} r="1.8" fill={NAVY} />
          {/* Bridge */}
          <line
            x1={leftX + 5}
            y1={eyeY}
            x2={rightX - 5}
            y2={eyeY}
            stroke={NAVY}
            strokeWidth="2"
          />
          {/* Thoughtful smile */}
          <path
            d="M 54 76 Q 60 80, 66 76"
            stroke={NAVY}
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      );
  }
}

function XEye({ cx, cy }: { cx: number; cy: number }) {
  const s = 3;
  return (
    <g>
      <line
        x1={cx - s}
        y1={cy - s}
        x2={cx + s}
        y2={cy + s}
        stroke={NAVY}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1={cx - s}
        y1={cy + s}
        x2={cx + s}
        y2={cy - s}
        stroke={NAVY}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </g>
  );
}

function Extras({ state }: { state: PepperState }) {
  switch (state) {
    case "thinking":
      return (
        <g>
          {/* 3 sparkles above head */}
          <Sparkle x={30} y={24} scale={1} />
          <Sparkle x={60} y={14} scale={0.8} />
          <Sparkle x={92} y={26} scale={1.1} />
        </g>
      );
    case "spicy":
      return (
        <g>
          {/* Tiny flame above */}
          <path
            d="M 60 18 C 56 10, 64 6, 60 -2 C 70 4, 72 16, 66 22 C 64 20, 62 20, 60 22 Z"
            fill={CORAL}
            stroke={NAVY}
            strokeWidth="2"
            strokeLinejoin="round"
            transform="translate(0,10)"
          />
        </g>
      );
    case "alert":
      return (
        <g>
          {/* Exclamation badge top-right */}
          <circle cx="96" cy="24" r="11" fill={CORAL} stroke={NAVY} strokeWidth="2.5" />
          <rect x="94.5" y="18" width="3" height="8" fill={NAVY} rx="1.5" />
          <circle cx="96" cy="29" r="1.5" fill={NAVY} />
        </g>
      );
    case "hype":
      return (
        <g>
          <Sparkle x={26} y={40} scale={1.1} />
          <Sparkle x={98} y={56} scale={1.2} />
          <Sparkle x={30} y={94} scale={0.9} />
        </g>
      );
    default:
      return null;
  }
}

function Sparkle({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  const s = 4 * scale;
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d={`M 0 ${-s} L 1 -1 L ${s} 0 L 1 1 L 0 ${s} L -1 1 L ${-s} 0 L -1 -1 Z`}
        fill={BANANA}
        stroke={NAVY}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </g>
  );
}
