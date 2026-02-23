import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { MarkdownTextarea } from '@/components/MarkdownTextarea';
import { TemplateFieldRow } from '@/lib/api';

interface DynamicFieldProps {
  field: TemplateFieldRow;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export const DynamicField = ({ field, value, onChange, error }: DynamicFieldProps) => {
  const renderField = () => {
    switch (field.field_type) {
      case 'text':
        return (
          <Input
            id={field.field_name}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || ''}
            required={field.required === 1}
          />
        );

      case 'textarea':
        return (
          <MarkdownTextarea
            id={field.field_name}
            value={value}
            onChange={onChange}
            placeholder={field.placeholder || ''}
            rows={4}
            required={field.required === 1}
          />
        );

      case 'number':
        return (
          <Input
            id={field.field_name}
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || ''}
            required={field.required === 1}
          />
        );

      case 'select':
        const options = field.options ? JSON.parse(field.options) : [];
        return (
          <Select value={value} onValueChange={onChange} required={field.required === 1}>
            <SelectTrigger id={field.field_name}>
              <SelectValue placeholder={field.placeholder || 'Välj...'} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option: string) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'checkbox':
        return (
          <div className="flex items-center space-x-2">
            <Checkbox
              id={field.field_name}
              checked={value === 'Ja' || value === 'true'}
              onCheckedChange={(checked) => onChange(checked ? 'Ja' : 'Nej')}
            />
          </div>
        );

      default:
        return <Input value={value} onChange={(e) => onChange(e.target.value)} />;
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={field.field_name}>
        {field.field_label} {field.required === 1 && '*'}
      </Label>
      {renderField()}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
};
