"use client"

import * as ResizablePrimitive from "react-resizable-panels"

import { ResizableHandle } from "@/components/ui/resizable-handle"
import { ResizablePanel } from "@/components/ui/resizable-panel"
import { cn } from "@/lib/utils"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
