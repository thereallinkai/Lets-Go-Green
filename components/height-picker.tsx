"use client";

import { useState } from "react";
import { Ruler } from "lucide-react";
import { parseOptionalHeight } from "@/src/lib/onboarding-input";
import styles from "./height-picker.module.css";

type HeightMode = "metric" | "imperial";

const CENTIMETERS = Array.from({ length: 251 }, (_, index) => index + 50);
const FEET = Array.from({ length: 8 }, (_, index) => index + 2);
const INCHES = Array.from({ length: 12 }, (_, index) => index);

function parsedCentimeters(value: string) {
  const parsed = parseOptionalHeight(value);
  return parsed.ok && parsed.heightCm !== null ? parsed.heightCm : null;
}

function modeFor(value: string, preferredUnit: "kg" | "lb"): HeightMode {
  if (/\b(?:ft|feet|foot|in|inch)|['′"″]/i.test(value)) return "imperial";
  if (value.trim()) return "metric";
  return preferredUnit === "lb" ? "imperial" : "metric";
}

function imperialParts(heightCm: number | null) {
  if (heightCm === null) return { feet: "", inches: "" };
  const totalInches = Math.round(heightCm / 2.54);
  return {
    feet: String(Math.floor(totalInches / 12)),
    inches: String(totalInches % 12),
  };
}

function metricSummary(heightCm: number) {
  const totalInches = Math.round(heightCm / 2.54);
  return `${heightCm} cm equals ${Math.floor(totalInches / 12)} ft ${totalInches % 12} in`;
}

export function HeightPicker({
  value,
  preferredUnit,
  invalid = false,
  onChange,
}: {
  value: string;
  preferredUnit: "kg" | "lb";
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  const heightCm = parsedCentimeters(value);
  const [mode, setMode] = useState<HeightMode>(() =>
    modeFor(value, preferredUnit),
  );
  const selectedMode = value.trim() ? modeFor(value, preferredUnit) : mode;
  const imperial = imperialParts(heightCm);
  const summaryId = "height-picker-summary";

  function switchMode(nextMode: HeightMode) {
    if (nextMode === selectedMode) return;
    setMode(nextMode);
    if (heightCm === null) {
      onChange("");
      return;
    }
    if (nextMode === "metric") {
      onChange(`${Math.round(heightCm)} cm`);
      return;
    }
    const converted = imperialParts(heightCm);
    onChange(`${converted.feet} ft ${converted.inches} in`);
  }

  function updateImperial(feet: string, inches: string) {
    if (!feet) {
      onChange("");
      return;
    }
    const maximumInches = feet === "9" ? 10 : 11;
    const safeInches = String(
      Math.min(maximumInches, Math.max(0, Number(inches || "0"))),
    );
    const centimeters = (Number(feet) * 12 + Number(safeInches)) * 2.54;
    if (centimeters < 50 || centimeters > 300) {
      onChange("");
      return;
    }
    onChange(`${feet} ft ${safeInches} in`);
  }

  return (
    <fieldset
      className={`${styles.picker} ${invalid ? styles.invalid : ""}`}
      aria-describedby={summaryId}
      aria-invalid={invalid || undefined}
    >
      <legend className={styles.legend}>Height</legend>
      <div className={styles.unitSwitch} aria-label="Height unit">
        <button
          className={styles.unitButton}
          type="button"
          aria-pressed={selectedMode === "metric"}
          onClick={() => switchMode("metric")}
        >
          Centimeters
        </button>
        <button
          className={styles.unitButton}
          type="button"
          aria-pressed={selectedMode === "imperial"}
          onClick={() => switchMode("imperial")}
        >
          Feet &amp; inches
        </button>
      </div>

      {selectedMode === "metric" ? (
        <div className={`${styles.selectGrid} ${styles.selectGridSingle}`}>
          <label className={styles.selectLabel}>
            Choose centimeters
            <select
              aria-required="true"
              required
              value={heightCm === null ? "" : String(Math.round(heightCm))}
              onChange={(event) =>
                onChange(event.target.value ? `${event.target.value} cm` : "")
              }
            >
              <option value="">Select height</option>
              {CENTIMETERS.map((centimeters) => (
                <option key={centimeters} value={centimeters}>
                  {centimeters} cm
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className={styles.selectGrid}>
          <label className={styles.selectLabel}>
            Feet
            <select
              aria-required="true"
              required
              value={imperial.feet}
              onChange={(event) =>
                updateImperial(event.target.value, imperial.inches)
              }
            >
              <option value="">Select feet</option>
              {FEET.map((feet) => (
                <option key={feet} value={feet}>
                  {feet} ft
                </option>
              ))}
            </select>
          </label>
          <label className={styles.selectLabel}>
            Inches
            <select
              value={imperial.inches}
              disabled={!imperial.feet}
              onChange={(event) =>
                updateImperial(imperial.feet, event.target.value)
              }
            >
              <option value="">Select inches</option>
              {INCHES.filter(
                (inches) => imperial.feet !== "9" || inches <= 10,
              ).map((inches) => (
                <option key={inches} value={inches}>
                  {inches} in
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <p className={styles.summary} id={summaryId} aria-live="polite">
        <Ruler aria-hidden="true" size={18} />
        <span>
          {heightCm === null ? (
            <>Choose your height from the list. It is required for the app&apos;s deterministic energy estimate.</>
          ) : (
            <><strong>{metricSummary(Math.round(heightCm))}.</strong> Height helps calculate your energy range; the plan does not guess or replace it.</>
          )}
        </span>
      </p>
    </fieldset>
  );
}
