"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TodayWeightTrendPoint = {
  day: string;
  weight: number;
};

type ProgressWeightTrendPoint = {
  day: string;
  weight: number | null;
  rollingAverage: number | null;
};

export type WeightTrendChartProps =
  | {
      data: TodayWeightTrendPoint[];
      kind: "today";
    }
  | {
      data: ProgressWeightTrendPoint[];
      kind: "progress";
      targetKg: number | null;
    };

export function WeightTrendChart(props: WeightTrendChartProps) {
  if (props.kind === "today") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={props.data}
          margin={{ top: 10, right: 12, left: -20, bottom: 0 }}
        >
          <CartesianGrid stroke="#e3dfd5" vertical={false} />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            fontSize={11}
          />
          <YAxis
            domain={["dataMin - 1", "dataMax + 1"]}
            axisLine={false}
            tickLine={false}
            fontSize={11}
          />
          <Tooltip
            formatter={(value) => [
              `${Number(value).toFixed(1)} kg`,
              "Weight",
            ]}
            contentStyle={{
              borderRadius: 10,
              borderColor: "#d9d4c8",
              fontSize: 12,
            }}
          />
          {props.data.length ? (
            <ReferenceLine
              y={props.data.at(-1)?.weight}
              stroke="#aeb7ad"
              strokeDasharray="4 4"
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="weight"
            stroke="#647632"
            strokeWidth={2.5}
            dot={{ fill: "#647632", r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  const hasSevenDayTrend = props.data.some(
    (point) => point.rollingAverage !== null,
  );
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={props.data}
        margin={{ top: 10, right: 18, left: -4, bottom: 0 }}
      >
        <CartesianGrid stroke="#e3dfd5" vertical={false} />
        <XAxis
          dataKey="day"
          axisLine={false}
          tickLine={false}
          fontSize={11}
        />
        <YAxis
          domain={["dataMin - 1", "dataMax + 1"]}
          axisLine={false}
          tickLine={false}
          fontSize={11}
        />
        <Tooltip
          formatter={(item, name) => [
            `${Number(item).toFixed(1)} kg`,
            name === "7-day average" ? "7-day average" : "Weight",
          ]}
        />
        {props.targetKg !== null ? (
          <ReferenceLine
            y={props.targetKg}
            stroke="#829248"
            strokeDasharray="5 5"
            label={{ value: "Goal", fontSize: 10 }}
          />
        ) : null}
        <Line
          name="Weight"
          type="monotone"
          dataKey="weight"
          stroke="#647632"
          strokeWidth={2.5}
          connectNulls={false}
        />
        {hasSevenDayTrend ? (
          <Line
            name="7-day average"
            type="monotone"
            dataKey="rollingAverage"
            stroke="#315f62"
            strokeDasharray="5 4"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        ) : null}
      </LineChart>
    </ResponsiveContainer>
  );
}
