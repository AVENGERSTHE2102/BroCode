// Adapted from shadcn/ui Textarea; styling lives in semantic CSS classes.
import * as React from "react";
import { clsx } from "clsx";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={clsx("ui-textarea", className)} {...props} />
));
Textarea.displayName = "Textarea";
