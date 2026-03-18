import pandas as pd
import json

df = pd.read_excel(r'd:\source\DRL\20260223_1124-DoseReport.xlsx', nrows=5)

with open('output_utf8.txt', 'w', encoding='utf-8') as f:
    f.write("Columns:\n")
    f.write(str(list(df.columns)) + "\n\n")
    f.write("First row values:\n")
    first_row = df.iloc[0].to_dict()
    for k, v in first_row.items():
        f.write(f"{k}: {v}\n")
