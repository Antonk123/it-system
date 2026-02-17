import { TemplateFieldRow, CustomFieldInput } from '@/lib/api';
import { DynamicField } from './DynamicField';
import { useState, useEffect } from 'react';

interface DynamicFieldsFormProps {
  fields: TemplateFieldRow[];
  onValuesChange: (values: CustomFieldInput[]) => void;
  initialValues?: CustomFieldInput[];
}

export const DynamicFieldsForm = ({ fields, onValuesChange, initialValues }: DynamicFieldsFormProps) => {
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Initialize field values: prefer initialValues (edit mode), fall back to defaults.
  // Only depends on `fields` so changing parent state doesn't reset user input.
  useEffect(() => {
    const saved: Record<string, string> = {};
    if (initialValues && initialValues.length > 0) {
      initialValues.forEach(v => { saved[v.fieldName] = v.fieldValue; });
    }
    const init: Record<string, string> = {};
    fields.forEach(field => {
      init[field.field_name] = saved[field.field_name] ?? field.default_value ?? '';
    });
    setFieldValues(init);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  // Notify parent of value changes
  useEffect(() => {
    const customFields: CustomFieldInput[] = fields.map(field => ({
      fieldName: field.field_name,
      fieldLabel: field.field_label,
      fieldValue: fieldValues[field.field_name] || '',
    }));
    onValuesChange(customFields);
  }, [fieldValues, fields, onValuesChange]);

  const handleFieldChange = (fieldName: string, value: string) => {
    setFieldValues(prev => ({ ...prev, [fieldName]: value }));
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
        <h3 className="text-sm font-semibold mb-3">Formulärfält</h3>
        <div className="space-y-4">
          {fields.map(field => (
            <DynamicField
              key={field.id}
              field={field}
              value={fieldValues[field.field_name] || ''}
              onChange={(value) => handleFieldChange(field.field_name, value)}
              error={errors[field.field_name]}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
