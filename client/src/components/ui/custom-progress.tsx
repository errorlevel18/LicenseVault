import { cn } from "@/lib/utils";
import "./progress.css";

interface ProgressBarProps {
  value: number;
  max?: number;
  variant?: "default" | "danger" | "warning" | "success";
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  variant = "default",
  className,
}: ProgressBarProps) {
  // Normalize value
  const normalizedValue = Math.min(Math.max(value, 0), max);
  const percent = (normalizedValue / max) * 100;
  
  // Determine variant class
  const variantClass = variant !== "default" ? `progress-bar-${variant}` : "";
  
  return (
    <div className={cn("progress", className)}>
      <div
        className={cn("progress-bar", variantClass)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
