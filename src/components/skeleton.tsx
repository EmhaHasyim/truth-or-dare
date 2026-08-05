import { For } from 'solid-js'

/** Single skeleton bar */
export function SkeletonBar(props: { class?: string }) {
  return <div class={`skeleton rounded-xl ${props.class || ''}`} />
}

/** Skeleton card (for room list items) */
export function SkeletonCard() {
  return (
    <div class="bg-base-100 rounded-2xl border border-base-200 p-4">
      <div class="flex items-center justify-between gap-3">
        <div class="flex-1 space-y-2">
          <SkeletonBar class="h-5 w-3/5" />
          <SkeletonBar class="h-4 w-2/5" />
        </div>
        <SkeletonBar class="h-10 w-16 rounded-xl" />
      </div>
    </div>
  )
}

/** Skeleton list of cards */
export function SkeletonCardList(props: { count?: number }) {
  return (
    <div class="space-y-2.5">
      <For each={Array.from({ length: props.count || 4 })}>{() => <SkeletonCard />}</For>
    </div>
  )
}

/** Skeleton player list (for lobby) */
export function SkeletonPlayerList(props: { count?: number }) {
  return (
    <div class="space-y-2">
      <For each={Array.from({ length: props.count || 3 })}>
        {() => (
          <div class="flex items-center gap-3 bg-base-200/70 rounded-xl px-4 py-3">
            <SkeletonBar class="w-9 h-9 rounded-full shrink-0" />
            <SkeletonBar class="h-4 flex-1" />
            <SkeletonBar class="h-5 w-12 rounded-full shrink-0" />
          </div>
        )}
      </For>
    </div>
  )
}
