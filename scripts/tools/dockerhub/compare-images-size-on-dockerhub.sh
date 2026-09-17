#!/bin/bash

([ -z "$1" ] || [ -z "$2" ]) && echo "Usage: $0 <previous-tag> <current-tag>" && exit 1;

PREV_TAG=$1
CURRENT_TAG=$2

IMAGES=(
    opencrvs/ocrvs-base
    opencrvs/ocrvs-client
    opencrvs/ocrvs-dashboards
    opencrvs/ocrvs-login
    opencrvs/ocrvs-gateway
    opencrvs/ocrvs-events
    opencrvs/ocrvs-auth
    opencrvs/ocrvs-migration
    opencrvs/ocrvs-documents
)

printf "\n%-30s %-12s %-16s %-11s %-15s %-15s %-10s\n" \
    "Image" "Prev Tag" "Prev Size (MB)" "Curr. Tag" "Curr. Size (MB)" "Diff. (MB)" "State"
for image in "${IMAGES[@]}";
do
    SIZE1=$(skopeo inspect --override-os linux --override-arch amd64 docker://ghcr.io/${image}:${PREV_TAG} -n | jq '[.LayersData[].Size] | add / 1024 / 1024 | floor') || (SIZE1=0; echo "Not found"; continue;)
    SIZE2=$(skopeo inspect --override-os linux --override-arch amd64 docker://ghcr.io/${image}:${CURRENT_TAG} -n | jq '[.LayersData[].Size] | add / 1024 / 1024 | floor') || (SIZE2=0; echo "Not found"; continue;)
    
    DIFF=$(( SIZE2 - SIZE1 ))
    if [ $DIFF -lt 0 ]; then
        DIFF_SIGN="👌"
    elif [ $DIFF -eq 0 ]; then
        DIFF_SIGN="✅"
    elif [ $DIFF -gt 0 ]; then
        if [ $DIFF -lt 10 ]; then
            DIFF_SIGN="✅"
        elif [ $DIFF -lt 50 ]; then
            DIFF_SIGN="⚠️";
        else
            DIFF_SIGN="❗️";
        fi
    fi

    printf "%-30s %-12s %-16s %-11s %-15s %+15d %-10s\n" \
        "$image" "$PREV_TAG" "$SIZE1" "$CURRENT_TAG" "$SIZE2" "$DIFF" "$DIFF_SIGN"
done
