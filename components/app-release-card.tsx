import { FlaskConical } from "lucide-react";
import { BRAND } from "@/src/lib/brand";

export function AppReleaseCard({
  channelLabel,
  displayVersion,
}: {
  channelLabel: string;
  displayVersion: string;
}) {
  return (
    <section
      aria-labelledby="app-release-title"
      className="card settings-section app-release-card"
      id="about"
    >
      <div className="card-title">
        <div>
          <h2 id="app-release-title">About {BRAND.name}</h2>
          <p>The exact application build you are currently testing.</p>
        </div>
        <FlaskConical aria-hidden="true" size={20} />
      </div>

      <div className="release-overview">
        <span className="release-channel">{channelLabel}</span>
        <div>
          <strong>{displayVersion}</strong>
          <p>
            This is a testing release. Features and stored-data formats may
            change before the stable release.
          </p>
        </div>
      </div>
    </section>
  );
}
