export type CsvRecord=Record<string,string>;

export function parseCsv(text:string):string[][]{
 const input=text.charCodeAt(0)===0xfeff?text.slice(1):text;const rows:string[][]=[];let row:string[]=[];let field='';let quoted=false;
 for(let i=0;i<input.length;i++){
  const char=input[i]!;
  if(char==='"'){if(quoted&&input[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
  else if(char===','&&!quoted){row.push(field);field='';}
  else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&input[i+1]==='\n')i++;row.push(field);if(row.some(value=>value.trim()))rows.push(row);row=[];field='';}
  else field+=char;
 }
 row.push(field);if(row.some(value=>value.trim()))rows.push(row);return rows;
}

export function parseCsvRecords(text:string,requiredHeaders:string[],maxRows=500):{records:CsvRecord[];totalRows:number}{
 const rows=parseCsv(text);const headers=rows.shift()?.map(value=>value.trim());
 if(!headers||requiredHeaders.some(header=>!headers.includes(header)))throw new Error(`CSV must include ${requiredHeaders.join(', ')} headers.`);
 if(!rows.length)throw new Error('CSV has no data rows.');
 const records=rows.slice(0,maxRows).map(row=>Object.fromEntries(headers.map((header,index)=>[header,row[index]?.trim()??''])));
 return{records,totalRows:rows.length};
}

export interface CsvImportResult{completed:number;failures:string[];totalRows:number;processedRows:number}
export async function importCsvFile(file:File,requiredHeaders:string[],importRecord:(record:CsvRecord)=>Promise<unknown>,describeRecord:(record:CsvRecord)=>string):Promise<CsvImportResult>{
 const{records,totalRows}=parseCsvRecords(await file.text(),requiredHeaders);let completed=0;const failures:string[]=[];
 for(const[index,record]of records.entries()){
  try{await importRecord(record);completed++;}
  catch(error){failures.push(`${describeRecord(record)||`Row ${index+2}`}: ${(error as Error).message}`);}
 }
 return{completed,failures,totalRows,processedRows:records.length};
}

export function csvImportMessage(result:CsvImportResult,noun:string):string{
 const limit=result.totalRows>result.processedRows?` Only the first ${result.processedRows} of ${result.totalRows} rows were processed.`:'';
 const firstError=result.failures[0]?` First error: ${result.failures[0]}`:'';
 return`${result.completed} ${noun} imported. ${result.failures.length} rejected.${limit}${firstError}`;
}
