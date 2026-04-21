"use client";

interface Props {
  items: Array<{
    phone_number: string;
    contact_name: string | null;
    last_called_at: string;
  }>;
  onPick: (phone: string) => void;
}

function shortLabel(phone: string, name: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  // Last 4 digits — what a rep thinks of as the "short" form.
  return digits.slice(-4);
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function RecentlyDialed({ items, onPick }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="w-full max-w-md mx-auto mt-4">
      <p className="text-[10px] text-slate uppercase tracking-wider font-bold text-center mb-2">
        Recently dialed
      </p>
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {items.slice(0, 5).map((item) => (
          <button
            key={item.phone_number}
            onClick={() => onPick(item.phone_number)}
            title={`${item.phone_number} · ${relative(item.last_called_at)}`}
            className="inline-flex items-center justify-center min-w-[48px] h-12 px-3 rounded-full bg-paper border-2 border-navy text-navy text-[13px] font-bold shadow-pop-sm shadow-pop-hover"
          >
            {shortLabel(item.phone_number, item.contact_name)}
          </button>
        ))}
      </div>
    </div>
  );
}
