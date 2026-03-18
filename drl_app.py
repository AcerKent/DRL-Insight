import streamlit as st
import pandas as pd
import plotly.express as px

st.set_page_config(page_title="CT DRL Analysis Dashboard", layout="wide", page_icon="📈")

# --- Custom CSS ---
st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        color: #4A90E2;
        font-weight: 700;
        text-align: center;
        margin-bottom: 30px;
    }
    .metric-container {
        background-color: #f8f9fa;
        padding: 15px;
        border-radius: 10px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
</style>
""", unsafe_allow_html=True)

st.markdown('<div class="main-header">CT 放射劑量參考水平 (DRL) 分析平台</div>', unsafe_allow_html=True)

@st.cache_data
def load_data():
    file_path = r'd:\source\DRL\20260223_1124-DoseReport.xlsx'
    df = pd.read_excel(file_path)
    
    # Preprocess Data
    if 'StudyDate' in df.columns:
        df['StudyDate'] = pd.to_datetime(df['StudyDate'], format='%Y%m%d', errors='coerce')
    
    # Fill NA for categorical
    for col in ['Acquisition Protocol', 'Target Region', 'StudyDescription']:
        if col in df.columns:
            df[col] = df[col].astype(str).fillna('Unknown')
    return df

with st.spinner('載入資料中...'):
    df_raw = load_data()

st.sidebar.header('篩選條件')

# Sidebar filters
if 'StudyDate' in df_raw.columns:
    min_date = df_raw['StudyDate'].min()
    max_date = df_raw['StudyDate'].max()
    if pd.notna(min_date) and pd.notna(max_date):
        date_range = st.sidebar.date_input(
            "選擇日期範圍",
            value=(min_date, max_date),
            min_value=min_date,
            max_value=max_date
        )
        if len(date_range) == 2:
            start_date, end_date = date_range
            df_filtered = df_raw[(df_raw['StudyDate'].dt.date >= start_date) & (df_raw['StudyDate'].dt.date <= end_date)]
        else:
            df_filtered = df_raw
    else:
        df_filtered = df_raw
else:
    df_filtered = df_raw

st.sidebar.markdown("---")
# Grouping selection
group_by = st.sidebar.selectbox(
    "選擇分類依據 (Group By)",
    ['Acquisition Protocol', 'Target Region', 'StudyDescription']
)

# Additional Filter for that specific group
group_options = df_filtered[group_by].unique().tolist()
selected_groups = st.sidebar.multiselect(
    f"選擇特定的 {group_by} (選填)",
    options=group_options,
    default=[]
)

if selected_groups:
    df_filtered = df_filtered[df_filtered[group_by].isin(selected_groups)]

# Layout columns for metrics
col1, col2, col3 = st.columns(3)
with col1:
    st.markdown('<div class="metric-container">', unsafe_allow_html=True)
    st.metric(label="總事件數 (Total Events)", value=f"{len(df_filtered):,}")
    st.markdown('</div>', unsafe_allow_html=True)
with col2:
    st.markdown('<div class="metric-container">', unsafe_allow_html=True)
    mean_ctdi = df_filtered['Mean CTDIvol (mGy)'].mean()
    st.metric(label="平均 CTDIvol (mGy)", value=f"{mean_ctdi:.2f}" if pd.notna(mean_ctdi) else "N/A")
    st.markdown('</div>', unsafe_allow_html=True)
with col3:
    st.markdown('<div class="metric-container">', unsafe_allow_html=True)
    mean_dlp = df_filtered['DLP (mGy.cm)'].mean()
    st.metric(label="平均 DLP (mGy.cm)", value=f"{mean_dlp:.2f}" if pd.notna(mean_dlp) else "N/A")
    st.markdown('</div>', unsafe_allow_html=True)

st.markdown("---")

tab1, tab2, tab3 = st.tabs(["📊 直方圖 (分布)", "📦 箱型圖 (比較)", "📈 折線圖 (趨勢)"])

metric_col = 'Mean CTDIvol (mGy)'
metric_col_dlp = 'DLP (mGy.cm)'

with tab1:
    st.subheader(f"CTDIvol & DLP 直方圖 ({group_by})")
    fig_ctdi_hist = px.histogram(df_filtered, x=group_by, y=metric_col, histfunc='avg', color=group_by, 
                                 title="CTDIvol 平均劑量", opacity=0.7)
    st.plotly_chart(fig_ctdi_hist, use_container_width=True)

    fig_dlp_hist = px.histogram(df_filtered, x=group_by, y=metric_col_dlp, histfunc='avg', color=group_by, 
                                title="DLP 平均劑量", opacity=0.7)
    st.plotly_chart(fig_dlp_hist, use_container_width=True)

with tab2:
    st.subheader(f"CTDIvol & DLP 各分類箱型圖 ({group_by})")
    fig_ctdi_box = px.box(df_filtered, x=group_by, y=metric_col, color=group_by, 
                          title=f"{group_by} vs CTDIvol", points="all")
    st.plotly_chart(fig_ctdi_box, use_container_width=True)

    fig_dlp_box = px.box(df_filtered, x=group_by, y=metric_col_dlp, color=group_by, 
                         title=f"{group_by} vs DLP", points="all")
    st.plotly_chart(fig_dlp_box, use_container_width=True)

with tab3:
    st.subheader(f"CTDIvol & DLP 隨時間變化趨勢 ({group_by})")
    if 'StudyDate' in df_filtered.columns and not df_filtered.empty:
        # Group by Date and the selected categorical variable
        trend_df = df_filtered.groupby(['StudyDate', group_by])[[metric_col, metric_col_dlp]].mean().reset_index()
        
        fig_ctdi_line = px.line(trend_df, x='StudyDate', y=metric_col, color=group_by, markers=True, 
                                title="CTDIvol 平均值隨時間趨勢")
        st.plotly_chart(fig_ctdi_line, use_container_width=True)
        
        fig_dlp_line = px.line(trend_df, x='StudyDate', y=metric_col_dlp, color=group_by, markers=True, 
                               title="DLP 平均值隨時間趨勢")
        st.plotly_chart(fig_dlp_line, use_container_width=True)
    else:
        st.info("目前的資料未包含有效的時間序列，無法顯示折線圖。")

st.markdown("---")
st.subheader("原始資料檢視")
st.dataframe(df_filtered)
