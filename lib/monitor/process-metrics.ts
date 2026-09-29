import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getCodexRequestMetricsSnapshot } from "@/lib/monitor/request-metrics";

const execFileAsync = promisify(execFile);

export type ProcessSample = {
  pid: number;
  parentPid: number;
  depth: number;
  elapsed: string;
  rssKb: number;
  cpuPercent: number;
  memoryPercent: number;
  command: string;
};

export type ProcessMetrics = {
  count: number;
  totalRssKb: number;
  maxRssKb: number;
  maxCpuPercent: number;
  processes: ProcessSample[];
};

export type MonitorSnapshot = {
  sampledAt: string;
  platform: string;
  processMetricsSupported: boolean;
  warning?: string;
  server: ProcessSample | null;
  codex: ProcessMetrics;
  service: ProcessMetrics;
  requests: ReturnType<typeof getCodexRequestMetricsSnapshot>;
};

type PsRecord = {
  pid: number;
  parentPid: number;
  rssKb: number;
  cpuPercent: number;
  memoryPercent: number;
  elapsed: string;
  args: string;
};

const codexExecPattern =
  /(?:^|\/)codex(?:\.exe)? exec(?:\s|$)|codex(?:\.exe)?\.js exec(?:\s|$)/;

function parseNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePsLine(line: string): PsRecord | null {
  const match = line.match(
    /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/,
  );

  if (!match) {
    return null;
  }

  return {
    pid: parseNumber(match[1]),
    parentPid: parseNumber(match[2]),
    rssKb: parseNumber(match[3]),
    cpuPercent: parseNumber(match[4]),
    memoryPercent: parseNumber(match[5]),
    elapsed: match[6],
    args: match[7],
  };
}

function summarize(processes: ProcessSample[]): ProcessMetrics {
  return {
    count: processes.length,
    totalRssKb: processes.reduce((total, process) => total + process.rssKb, 0),
    maxRssKb: processes.reduce((max, process) => Math.max(max, process.rssKb), 0),
    maxCpuPercent: processes.reduce(
      (max, process) => Math.max(max, process.cpuPercent),
      0,
    ),
    processes,
  };
}

async function sampleProcesses(): Promise<PsRecord[]> {
  const { stdout } = await execFileAsync(
    "ps",
    ["-Ao", "pid=,ppid=,rss=,pcpu=,pmem=,etime=,args="],
    { maxBuffer: 4 * 1024 * 1024 },
  );

  return stdout
    .split("\n")
    .map(parsePsLine)
    .filter((process): process is PsRecord => process !== null);
}

function collectProcessTrees(
  records: PsRecord[],
  rootPids: number[],
  includeRoot: boolean,
): ProcessSample[] {
  const recordsByPid = new Map(records.map((record) => [record.pid, record]));
  const childrenByPid = new Map<number, number[]>();

  for (const record of records) {
    const children = childrenByPid.get(record.parentPid) ?? [];
    children.push(record.pid);
    childrenByPid.set(record.parentPid, children);
  }

  const processes: ProcessSample[] = [];
  const visitedPids = new Set<number>();

  const visit = (pid: number, depth: number) => {
    if (visitedPids.has(pid)) {
      return;
    }

    const record = recordsByPid.get(pid);

    if (!record) {
      return;
    }

    visitedPids.add(pid);
    processes.push({
      pid: record.pid,
      parentPid: record.parentPid,
      depth,
      elapsed: record.elapsed,
      rssKb: record.rssKb,
      cpuPercent: record.cpuPercent,
      memoryPercent: record.memoryPercent,
      command: record.args,
    });

    for (const childPid of childrenByPid.get(pid) ?? []) {
      visit(childPid, depth + 1);
    }
  };

  for (const rootPid of rootPids) {
    visit(rootPid, includeRoot ? 0 : 1);
  }

  return processes.sort((first, second) =>
    first.depth === second.depth
      ? first.pid - second.pid
      : first.depth - second.depth,
  );
}

export async function getMonitorSnapshot(): Promise<MonitorSnapshot> {
  const requests = getCodexRequestMetricsSnapshot();
  const snapshot: MonitorSnapshot = {
    sampledAt: new Date().toISOString(),
    platform: process.platform,
    processMetricsSupported: process.platform !== "win32",
    server: null,
    codex: summarize([]),
    service: summarize([]),
    requests,
  };

  if (!snapshot.processMetricsSupported) {
    snapshot.warning = "当前平台不支持通过 ps 读取进程指标。";
    return snapshot;
  }

  try {
    const records = await sampleProcesses();
    const monitorProcessPids = new Set(
      records
        .filter(
          (record) =>
            record.parentPid === process.pid &&
            record.args.startsWith("ps -Ao pid=,ppid=,rss=,pcpu=,pmem=,etime=,args="),
        )
        .map((record) => record.pid),
    );
    const serviceRecords = records.filter(
      (record) => !monitorProcessPids.has(record.pid),
    );
    const serverRecord = records.find((record) => record.pid === process.pid);
    const serviceProcesses = collectProcessTrees(
      serviceRecords,
      [process.pid],
      true,
    );
    const codexRootPids = serviceRecords
      .filter(
        (record) =>
          record.parentPid === process.pid &&
          codexExecPattern.test(record.args),
      )
      .map((record) => record.pid);
    const codexProcesses = collectProcessTrees(records, codexRootPids, true);

    if (serverRecord) {
      snapshot.server = {
        pid: serverRecord.pid,
        parentPid: serverRecord.parentPid,
        depth: 0,
        elapsed: serverRecord.elapsed,
        rssKb: serverRecord.rssKb,
        cpuPercent: serverRecord.cpuPercent,
        memoryPercent: serverRecord.memoryPercent,
        command: serverRecord.args,
      };
    }

    snapshot.codex = summarize(codexProcesses);
    snapshot.service = summarize(serviceProcesses);
  } catch (error) {
    snapshot.processMetricsSupported = false;
    snapshot.warning =
      error instanceof Error ? error.message : "读取进程指标失败。";
  }

  return snapshot;
}
