import { TemplateFieldRow, CustomFieldInput } from '@/lib/api';
import { DynamicField } from './DynamicField';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface DynamicFieldsFormProps {
  requester?: { name: string; email: string; actionLabel: string };
  disabled?: boolean;
  onImageBusyChange?: (busy: boolean) => void;
  fields: TemplateFieldRow[];
  onValuesChange: (values: CustomFieldInput[]) => void;
  initialValues?: CustomFieldInput[];
  // Validation errors supplied by the parent form, keyed by field_name.
  // Additive/optional — when omitted, behavior is unchanged.
  errors?: Record<string, string>;
}

export const DynamicFieldsForm = ({ fields, onValuesChange, initialValues, errors: externalErrors, disabled, onImageBusyChange, requester }: DynamicFieldsFormProps) => {
  const initialize = () => {
    const saved = new Map((initialValues || []).map(v => [v.fieldName, v.fieldValue]));
    return Object.fromEntries(fields.map(field => [field.field_name, saved.get(field.field_name) ?? field.default_value ?? '']));
  };
  const signature = JSON.stringify(fields);
  const [state, setState] = useState(() => ({ signature, values: initialize() }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Reset only when the definition changes, never on a background refetch's new array identity.
  // Render-time adjustment prevents notifying the parent with an empty intermediate snapshot.
  if (state.signature !== signature) setState({ signature, values: initialize() });
  const fieldValues = state.values;

  // Notify parent of value changes (runs immediately when fields change)
  useEffect(() => {
    const customFields: CustomFieldInput[] = fields.map(field => ({
      fieldName: field.field_name,
      fieldLabel: field.field_label,
      fieldValue: fieldValues[field.field_name] || '',
    }));

    onValuesChange(customFields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]); // Initial/default values only; edits notify synchronously below.

  const handleFieldChange = (fieldName: string, value: string) => {
    const values = { ...fieldValues, [fieldName]: value };
    setState(prev => ({ ...prev, values }));
    onValuesChange(fields.map(field => ({ fieldName: field.field_name, fieldLabel: field.field_label, fieldValue: values[field.field_name] || '' })));
    // Clear error when field is modified
    if (errors[fieldName]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold mb-3">Uppgifter om ärendet</h3>
        <div className="space-y-4">
          {fields.map(field => (
            <div key={field.id} className="space-y-2">
              <DynamicField
                field={field}
                disabled={disabled}
                onImageBusyChange={onImageBusyChange}
                value={fieldValues[field.field_name] || ''}
                onChange={(value) => handleFieldChange(field.field_name, value)}
                error={externalErrors?.[field.field_name] ?? errors[field.field_name]}
              />
              {requester && field.field_name === 'anvandare' && field.field_type === 'text' && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" className="min-h-11" disabled={disabled || !requester.name.trim() || !requester.email.trim()}
                    onClick={() => handleFieldChange(field.field_name, `${requester.name.trim()} (${requester.email.trim()})`)}>
                    {requester.actionLabel}
                  </Button>
                  <p className="text-xs text-muted-foreground">Den som behöver åtkomst. Återanvänd kontaktuppgifterna eller skriv en annan person.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
