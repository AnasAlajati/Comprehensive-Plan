# Yarn Inventory Module Guide

## Overview
The Yarn Inventory module allows you to track yarn stock levels by importing data from Excel files. It is designed to handle large datasets and intelligently update existing records based on Yarn Name and Lot Number.

## Excel File Format
The system expects a specific Excel format to ensure data is imported correctly:

- **Row 1**: Header Row (Ignored by importer)
- **Row 2**: Irrelevant Data (Ignored by importer)
- **Row 3+**: Data Rows (Imported)

### Column Mapping
- **Column A (Index 0)**: Yarn Name
- **Column B (Index 1)**: Lot Number
- **Column C (Index 2)**: Quantity (kg)

## Features

### 1. Smart Import
- **Duplicate Prevention**: The system checks if a yarn with the same Name and Lot Number already exists.
- **Update Logic**: 
  - If the record exists, it updates the quantity.
  - If the record is new, it creates a new entry.
- **Batch Processing**: Handles large files efficiently using Firestore batch writes.

### 2. Inventory Dashboard
- **Total Stock**: Shows total kilograms of yarn in inventory.
- **Unique Yarns**: Count of distinct yarn types.
- **Low Stock Alerts**: Indicators for items with low quantity (default < 50kg).

### 3. Search & Filtering
- Real-time search by Yarn Name or Lot Number.

## How to Use

1. **Navigate**: Click the "Yarn Inv." button in the main navigation bar.
2. **Import**: 
   - Click "Import Excel".
   - Select your `.xlsx` or `.xls` file.
   - Wait for the "Import Complete" notification.
3. **View**: The table will automatically refresh with the latest data.

## Technical Details
- **Collection**: `yarn_inventory` in Firestore.
- **Composite Key**: Logic uses `${yarnName}-${lotNumber}` to identify unique records.
