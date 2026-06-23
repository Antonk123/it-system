import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { TemplateFieldRow } from '@/lib/api';
import { safeJsonParse } from '@/lib/safeJsonParse';

interface DynamicFieldProps {
  field: TemplateFieldRow;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export const DynamicField = ({ field, value, onChange, error }: DynamicFieldProps) => {
  const errorId = `${field.field_name}-error`;
  // a11y: when an error is present, associate it with the control and mark invalid.
  const a11yProps = error
    ? { 'aria-describedby': errorId, 'aria-invalid': true }
    : {};

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
            {...a11yProps}
          />
        );

      case 'textarea':
        // RichTextEditor has a typed prop surface (no aria-* passthrough); it
        // exposes an `error` boolean for invalid styling instead.
        return (
          <RichTextEditor
            value={value}
            onChange={onChange}
            placeholder={field.placeholder || 'Skriv här...'}
            minHeight="150px"
            required={field.required === 1}
            id={field.field_name}
            error={!!error}
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
            {...a11yProps}
          />
        );

      case 'select': {
        const options = safeJsonParse<string[]>(field.options, []);
        return (
          <Select value={value} onValueChange={onChange} required={field.required === 1}>
            <SelectTrigger id={field.field_name} {...a11yProps}>
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
      }

      case 'checkbox':
        return (
          <div className="flex items-center space-x-2">
            <Checkbox
              id={field.field_name}
              checked={value === 'Ja' || value === 'true'}
              onCheckedChange={(checked) => onChange(checked ? 'Ja' : 'Nej')}
              {...a11yProps}
            />
          </div>
        );

      case 'date':
        return (
          <Input
            id={field.field_name}
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || ''}
            required={field.required === 1}
            {...a11yProps}
          />
        );

      default:
        return (
          <Input
            id={field.field_name}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={field.field_label}
            {...a11yProps}
          />
        );
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={field.field_name}>
        {field.field_label} {field.required === 1 && '*'}
      </Label>
      {renderField()}
      {error && <p id={errorId} className="text-sm text-destructive">{error}</p>}
    </div>
  );
};
