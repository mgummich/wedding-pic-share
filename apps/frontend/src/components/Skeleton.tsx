export function SkeletonCard() {
  return (
    <div
      className="rounded-thumb bg-ui-border animate-pulse"
      style={{ aspectRatio: '4/3' }}
      aria-hidden="true"
    />
  )
}

export function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="columns-2 sm:columns-3 md:columns-4 gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="mb-2 break-inside-avoid">
          <SkeletonCard />
        </div>
      ))}
    </div>
  )
}
