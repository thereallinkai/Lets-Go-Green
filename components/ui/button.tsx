import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/src/lib/utils";

const buttonVariants = cva(
  "ui-button inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-transparent px-5 py-3 text-sm font-bold transition-[transform,box-shadow,background-color,border-color,color,opacity] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7d4e] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fbfef9] disabled:pointer-events-none disabled:opacity-55",
  {
    variants: {
      variant: {
        default:
          "ui-button-default bg-[#123524] text-white shadow-[0_7px_20px_rgba(18,53,36,0.16)] hover:bg-[#194a32] hover:shadow-[0_10px_26px_rgba(18,53,36,0.2)]",
        accent:
          "ui-button-accent bg-[#b8e36d] text-[#123524] shadow-[0_7px_20px_rgba(31,107,67,0.12)] hover:bg-[#c8ee82] hover:shadow-[0_10px_26px_rgba(31,107,67,0.17)]",
        outline:
          "ui-button-outline border-[#bfd4c2] bg-white/25 text-[#123524] hover:border-[#8bb897] hover:bg-white/70",
        danger:
          "ui-button-danger border-[#9b3d35]/35 bg-[#fff8f7] text-[#9b3d35] hover:border-[#9b3d35]/55 hover:bg-[#fff2f0]",
      },
      size: {
        default: "min-h-12",
        sm: "min-h-11 px-4 py-2 text-[0.92rem]",
        icon: "size-11 rounded-full p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  asChild = false,
  className,
  variant,
  size,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
