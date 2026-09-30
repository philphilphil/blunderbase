import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as React from 'react'

import { cn } from '@/lib/utils'

function TooltipProvider({
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

/**
 * A tooltip's trigger. `wrapDisabled` is for a trigger that can be a disabled button: the
 * button then sits in a span that carries the tooltip, so the reason it is disabled can
 * still be read (the clarity pass, spec §3.2) in a browser that sends a disabled control
 * no pointer events, and the span takes the tab stop the disabled button gave up.
 *
 * Opt-in and always wrapped, never swapped in when the button turns disabled: changing
 * the tree at that moment would remount the button, dropping its focus and any reference
 * a caller or a test holds to it.
 */
function TooltipTrigger({
  asChild,
  wrapDisabled = false,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger> & { wrapDisabled?: boolean }) {
  if (wrapDisabled) {
    const disabled =
      React.isValidElement<{ disabled?: boolean }>(children) && Boolean(children.props.disabled)
    return (
      <TooltipPrimitive.Trigger data-slot="tooltip-trigger" asChild {...props}>
        <span tabIndex={disabled ? 0 : undefined} className="inline-flex">
          {children}
        </span>
      </TooltipPrimitive.Trigger>
    )
  }
  return (
    <TooltipPrimitive.Trigger data-slot="tooltip-trigger" asChild={asChild} {...props}>
      {children}
    </TooltipPrimitive.Trigger>
  )
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-md border border-edge bg-elevated px-2 py-1 text-label text-body shadow-lg',
          'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
