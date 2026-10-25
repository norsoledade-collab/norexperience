import { supabase } from "@/integrations/supabase/client";

/** Cada estrutura do modelo fica 4 semanas (28 dias) com o aluno. */
export const PERIOD_WEEKS = 4;
export const PERIOD_DAYS = PERIOD_WEEKS * 7;

export type SequenceExercise = {
  name: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  notes: string;
};

/**
 * Estrutura fixa (Treino 1, Treino 2...).
 * Grupos musculares, divisão, regras e ordem são definidos pelo treinador e não podem
 * ser alterados pela IA.
 */
export type SequenceBlock = {
  label: string;
  muscle_groups: string;
  division: string;
  rules: string;
  exercises: SequenceExercise[];
};

export type TrainingSequence = {
  id: string;
  name: string;
  structures: SequenceBlock[];
  created_at: string | null;
};

export type StudentRow = {
  id: string;
  full_name: string;
  is_active: boolean;
};

export type StudentSequenceRow = {
  id: string;
  student_id: string;
  sequence_id: string;
  sequence_name: string;
  structures: SequenceBlock[];
  start_index: number;
  started_on: string;
  active: boolean;
  created_at: string | null;
};

export type StructureProgress = {
  index: number;
  block: SequenceBlock | null;
  period_start: string;
  period_end: string;
  days_remaining: number;
  is_last: boolean;
  finished: boolean;
  next_block: SequenceBlock | null;
  passes_on: string | null;
};

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso.slice(0, 10)}T00:00:00`).getTime();
  const to = new Date(`${toIso.slice(0, 10)}T00:00:00`).getTime();
  return Math.round((to - from) / 86_400_000);
}

export function formatDateBR(isoDate: string | null): string {
  if (!isoDate) return "—";
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  if (!year || !month || !day) return isoDate;
  return `${day}/${month}/${year}`;
}

export function cloneBlocks(blocks: SequenceBlock[]): SequenceBlock[] {
  return blocks.map((block) => ({
    label: block.label,
    muscle_groups: block.muscle_groups,
    division: block.division,
    rules: block.rules,
    exercises: block.exercises.map((exercise) => ({ ...exercise })),
  }));
}

export function nextTemplateName(sequences: TrainingSequence[]): string {
  const used = sequences
    .map((sequence) => /^sequ[eê]ncia\s+(\d+)$/i.exec(sequence.name.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]));

  const next = used.length > 0 ? Math.max(...used) + 1 : sequences.length + 1;
  return `Sequência ${next}`;
}

export function nextStructureLabel(blocks: SequenceBlock[]): string {
  const used = blocks
    .map((block) => /^treino\s+(\d+)$/i.exec(block.label.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]));

  const next = used.length > 0 ? Math.max(...used) + 1 : blocks.length + 1;
  return `Treino ${next}`;
}

export function emptyBlock(existing: SequenceBlock[]): SequenceBlock {
  return {
    label: nextStructureLabel(existing),
    muscle_groups: "",
    division: "",
    rules: "",
    exercises: [],
  };
}

function parseExercise(value: unknown): SequenceExercise {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    sets: Number(raw.sets ?? 3) || 3,
    reps: typeof raw.reps === "string" ? raw.reps : String(raw.reps ?? "10-12"),
    rest_seconds: Number(raw.rest_seconds ?? 60) || 60,
    notes: typeof raw.notes === "string" ? raw.notes : "",
  };
}

function parseBlock(value: unknown, index: number): SequenceBlock {
  const raw = (value ?? {}) as Record<string, unknown>;
  const rawExercises = Array.isArray(raw.exercises) ? raw.exercises : [];

  return {
    label:
      typeof raw.label === "string" && raw.label.trim().length > 0
        ? raw.label
        : `Treino ${index + 1}`,
    muscle_groups: typeof raw.muscle_groups === "string" ? raw.muscle_groups : "",
    division: typeof raw.division === "string" ? raw.division : "",
    rules: typeof raw.rules === "string" ? raw.rules : "",
    exercises: rawExercises.map(parseExercise),
  };
}

/** Aceita tanto o array simples (modelos e atribuições antigas) quanto o objeto { start_index, blocks }. */
function toBlocks(value: unknown): SequenceBlock[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => parseBlock(item, index));
  }

  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    if (Array.isArray(raw.blocks)) {
      return raw.blocks.map((item, index) => parseBlock(item, index));
    }
  }

  return [];
}

function toStartIndex(value: unknown): number {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>;
    const parsed = Number(raw.start_index ?? 0);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return 0;
}

/**
 * Contrato entregue à IA para uma estrutura fixa.
 * A IA só pode escolher/incluir exercícios compatíveis com os grupos musculares definidos;
 * estrutura, divisão, regras e ordem ficam travadas pelo treinador.
 */
export function structureAIContract(block: SequenceBlock): string {
  return [
    `Estrutura fixa: ${block.label}`,
    `Grupos musculares permitidos: ${block.muscle_groups || "não definidos pelo treinador"}`,
    `Divisão: ${block.division || "não definida"}`,
    `Regras: ${block.rules || "sem regras adicionais"}`,
    "A IA pode apenas selecionar e incluir exercícios adequados aos grupos musculares acima.",
    "É proibido alterar o nome da estrutura, os grupos musculares, a divisão, as regras ou a ordem das estruturas.",
  ].join("\n");
}

/** Inclui exercícios gerados pela IA sem tocar em estrutura, divisão, regras ou ordem. */
export function appendAIExercises(
  block: SequenceBlock,
  generated: SequenceExercise[],
): SequenceBlock {
  return {
    ...block,
    exercises: [...block.exercises, ...generated.map((exercise) => ({ ...exercise }))],
  };
}

export function computeProgress(
  assignment: Pick<StudentSequenceRow, "started_on" | "start_index" | "structures">,
  today: string = todayIso(),
): StructureProgress {
  const blocks = assignment.structures;
  const total = blocks.length;

  if (total === 0) {
    return {
      index: 0,
      block: null,
      period_start: assignment.started_on,
      period_end: assignment.started_on,
      days_remaining: 0,
      is_last: true,
      finished: true,
      next_block: null,
      passes_on: null,
    };
  }

  const startIndex = Math.min(Math.max(assignment.start_index ?? 0, 0), total - 1);
  const elapsedDays = Math.max(daysBetween(assignment.started_on, today), 0);
  const periodsPassed = Math.floor(elapsedDays / PERIOD_DAYS);
  const rawIndex = startIndex + periodsPassed;

  // Não há reinício: ao passar da última estrutura, o aluno fica nela até a troca manual.
  const finished = rawIndex > total - 1;
  const index = Math.min(rawIndex, total - 1);

  const periodStart = addDays(assignment.started_on, (index - startIndex) * PERIOD_DAYS);
  const periodEnd = addDays(periodStart, PERIOD_DAYS);
  const daysRemaining = Math.max(daysBetween(today, periodEnd), 0);
  const nextBlock = index + 1 < total ? blocks[index + 1] : null;

  return {
    index,
    block: blocks[index] ?? null,
    period_start: periodStart,
    period_end: periodEnd,
    days_remaining: daysRemaining,
    is_last: index === total - 1,
    finished,
    next_block: nextBlock,
    passes_on: nextBlock ? periodEnd : null,
  };
}

export async function listSequences(): Promise<TrainingSequence[]> {
  const { data, error } = await supabase
    .from("training_sequences")
    .select("id, name, structures, created_at")
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    structures: toBlocks(row.structures),
    created_at: row.created_at ?? null,
  }));
}

export async function createSequence(name: string, structures: SequenceBlock[]): Promise<string> {
  const { data, error } = await supabase
    .from("training_sequences")
    .insert({ name, structures: structures as never })
    .select("id")
    .single();

  if (error) throw error;

  return (data as { id: string }).id;
}

export async function updateSequence(
  id: string,
  name: string,
  structures: SequenceBlock[],
): Promise<void> {
  const { error } = await supabase
    .from("training_sequences")
    .update({ name, structures: structures as never, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
}

export async function listStudents(): Promise<StudentRow[]> {
  const { data, error } = await supabase
    .from("students")
    .select("id, full_name, is_active")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    full_name: row.full_name,
    is_active: row.is_active,
  }));
}

export async function listActiveAssignments(): Promise<StudentSequenceRow[]> {
  const { data, error } = await supabase
    .from("student_training_sequences")
    .select("id, student_id, sequence_id, sequence_name, structures, started_on, active, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    student_id: row.student_id,
    sequence_id: row.sequence_id,
    sequence_name: row.sequence_name,
    structures: toBlocks(row.structures),
    start_index: toStartIndex(row.structures),
    started_on: row.started_on,
    active: row.active,
    created_at: row.created_at ?? null,
  }));
}

/**
 * Atribui o modelo ao aluno posicionando-o na estrutura inicial escolhida.
 * A posição fica gravada no próprio jsonb structures, junto com a cópia das estruturas,
 * e o avanço das 4 semanas é contado a partir de started_on.
 */
export async function assignSequence(
  studentId: string,
  sequence: Pick<TrainingSequence, "id" | "name" | "structures">,
  startIndex = 0,
): Promise<void> {
  const blocks = cloneBlocks(sequence.structures);
  const safeStart = Math.min(
    Math.max(Math.floor(startIndex), 0),
    Math.max(blocks.length - 1, 0),
  );

  const { error: deactivateError } = await supabase
    .from("student_training_sequences")
    .update({ active: false })
    .eq("student_id", studentId)
    .eq("active", true);

  if (deactivateError) throw deactivateError;

  const { error } = await supabase.from("student_training_sequences").insert({
    student_id: studentId,
    sequence_id: sequence.id,
    sequence_name: sequence.name,
    structures: { start_index: safeStart, blocks } as never,
    started_on: todayIso(),
    active: true,
  });

  if (error) throw error;
}
