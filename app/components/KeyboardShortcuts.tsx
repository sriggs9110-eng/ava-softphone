"use client";

import { HelpCircle, X } from "lucide-react";

interface KeyboardShortcutsProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: "Enter", action: "Initiate call" },
  { key: "Escape", action: "End call" },
  { key: "M", action: "Toggle mute" },
  { key: "H", action: "Toggle hold" },
  { key: "0–9", action: "Dial digits" },
  { key: "Backspace", action: "Delete last digit" },
  { key: "?", action: "Show shortcuts" },
];

export function ShortcutsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative w-10 h-10 rounded-xl flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated transition-all duration-150"
    >
      <HelpCircle size={18} />
      <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-bg-elevated border border-border-subtle rounded-lg text-[11px] text-text-secondary whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
        Shortcuts
      </div>
    </button>
  );
}

export default function KeyboardShortcuts({ open, onClose }: KeyboardShortcutsProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-app/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-bg-surface border border-border-subtle rounded-xl p-6 max-w-md w-full mx-4 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-text-primary">
            Keyboard Shortcuts
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-1">
          {SHORTCUTS.map(({ key, action }) => (
            <div
              key={key}
              className="flex items-center justify-between py-2 px-1"
            >
              <span className="text-[13px] text-text-secondary">{action}</span>
              <kbd className="px-2.5 py-1 rounded-lg bg-bg-elevated border border-border-subtle text-[12px] font-mono font-semibold text-text-primary min-w-[40px] text-center">
                {key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
