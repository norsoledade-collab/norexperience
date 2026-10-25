import { supabase } from "@/integrations/supabase/client";

export const PERIOD_DAYS = 30;

export type SequenceExercise = {
  name: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  notes: string;
};

export type SequenceBlock = {
  label: string;
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
  started_on: string;
  active: boolean;
  created_at: string | null;
};

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
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
    exercises: block.exercises.map((exercise) => ({ ...exercise })),
  }));
}

export function nextTemplateName(sequences: TrainingSequence[]): string {
  const used = sequences
    .map((sequence) => /^treino\s+(\d+)$/i.exec(sequence.name.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]));

  const next = used.length > 0 ? Math.max(...used) + 1 : sequences.length + 1;
  return `Treino ${next}`;
}

function toBlocks(value: unknown): SequenceBlock[] {
  if (!Array.isArray(value)) return [];

  return value.map((item, index) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const rawExercises = Array.isArray(raw.exercises) ? raw.exercises : [];

    return {
      label:
        typeof raw.label === "string" && raw.label.trim().length > 0
          ? raw.label
          : `Treino ${String.fromCharCode(65 + index)}`,
      exercises: rawExercises.map((exercise) => {
        const rawExercise = (exercise ?? {}) as Record<string, unknown>;
        return {
          name: typeof rawExercise.name === "string" ? rawExercise.name : "",
          sets: Number(rawExercise.sets ?? 3) || 3,
          reps: typeof rawExercise.reps === "string" ? rawExercise.reps : String(rawExercise.reps ?? "10-12"),
          rest_seconds: Number(rawExercise.rest_seconds ?? 60) || 60,
          notes: typeof rawExercise.notes === "string" ? rawExercise.notes : "",
        };
      }),
    };
  });
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
    started_on: row.started_on,
    active: row.active,
    created_at: row.created_at ?? null,
  }));
}

export async function assignSequence(
  studentId: string,
  sequence: Pick<TrainingSequence, "id" | "name" | "structures">,
): Promise<void> {
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
    structures: cloneBlocks(sequence.structures) as never,
    started_on: todayIso(),
    active: true,
  });

  if (error) throw error;
}
