interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function NotesField({ value, onChange }: Props) {
  return (
    <textarea
      className="notes"
      placeholder="Add a note…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
    />
  );
}
