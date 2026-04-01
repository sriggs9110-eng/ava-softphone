"use client";

export default function MicError({ message }: { message: string }) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-red/90 text-white px-6 py-3 rounded-xl text-sm font-medium shadow-lg max-w-sm text-center">
      {message}
    </div>
  );
}
