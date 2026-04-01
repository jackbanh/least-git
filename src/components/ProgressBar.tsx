import { Progress } from "@mantine/core";
import "./ProgressBar.css";

export default function ProgressBar({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="progress-bar">
      <Progress value={100} animated size={2} radius={0} />
    </div>
  );
}
