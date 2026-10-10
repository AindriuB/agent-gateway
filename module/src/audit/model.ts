/* eslint-disable @typescript-eslint/no-explicit-any */
declare const foundry: any;

/**
 * The data model of the audit page subtype, built on first use: `TypeDataModel` and the field
 * classes only exist once Foundry has loaded. Size limits are enforced when a record is built
 * (record.ts); the schema only fixes the shape.
 */
export function createAuditModel(): any {
  const f = foundry.data.fields;
  class AuditData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
      return {
        entryId: new f.StringField({ required: true, blank: false, initial: 'unset' }),
        timestamp: new f.NumberField({ required: true, integer: true, initial: 0 }),
        userId: new f.StringField({ required: true, blank: true, initial: '' }),
        agentId: new f.StringField({ required: true, blank: true, initial: '' }),
        tool: new f.StringField({ required: true, blank: true, initial: '' }),
        category: new f.StringField({
          required: true,
          initial: 'write',
          choices: ['write', 'destructive', 'code'],
        }),
        args: new f.StringField({ required: true, blank: true, initial: '' }),
        argsTruncated: new f.BooleanField({ initial: false }),
        targets: new f.ArrayField(
          new f.SchemaField({
            uuid: new f.StringField({ required: true, blank: false }),
            existed: new f.BooleanField({ initial: true }),
            // JSON text, not an object: keys such as `-=x` or `a.b` mean something to Foundry's update logic.
            before: new f.StringField({ required: true, blank: true, initial: '' }),
            existsAfter: new f.BooleanField({ initial: true }),
            afterModifiedTime: new f.NumberField({ required: true, nullable: true, initial: null }),
            undoable: new f.BooleanField({ initial: true }),
            note: new f.StringField({ required: true, blank: true, initial: '' }),
          }),
        ),
        targetsDropped: new f.NumberField({ required: true, integer: true, initial: 0 }),
        result: new f.StringField({ required: true, blank: true, initial: '' }),
        status: new f.StringField({ required: true, initial: 'ok', choices: ['ok', 'error'] }),
        relayed: new f.BooleanField({ initial: false }),
        undoneAt: new f.NumberField({ required: true, nullable: true, initial: null }),
        undoneBy: new f.StringField({ required: true, blank: true, initial: '' }),
      };
    }
  }
  return AuditData;
}
